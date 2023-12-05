import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import AdmZip from 'adm-zip';
import { program } from 'commander';
import { checksum as getChecksum } from '@tomasklaen/checksum';
import { jsonLogger } from 'json_logger';
import { checkLatest } from '../api/update';
import {
    OptionsBase,
    getConfig,
    useLogSnag,
    regexSemver,
} from '../utils';
import { checkIndexPosition, searchInDirectory } from './check';

const alertMb = 20;

interface Options extends OptionsBase {
    bundle?: string
    path?: string
    codeCheck?: boolean
    name?: string
    json?: boolean
}

export const zipBundle = async (appId: string, options: Options) => {
    const logger = jsonLogger(options.json)
    await checkLatest(logger);
    let { bundle, path } = options;
    const snag = useLogSnag()

    const config = await getConfig();
    appId = appId || config?.app?.appId
    // create bundle name format : 1.0.0-beta.x where x is a uuid
    const uuid = randomUUID().split('-')[0];
    bundle = bundle || config?.app?.package?.version || `0.0.1-beta.${uuid}`

    logger.intro(`Zipping ${appId}@${bundle}`);
    // check if bundle is valid 
    if (!regexSemver.test(bundle)) {
        logger.error(`Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`);
        program.error('');
    }
    path = path || config?.app?.webDir
    if (!appId || !bundle || !path) {
        logger.error("Missing argument, you need to provide a appId and a bundle and a path, or be in a capacitor project");
        program.error('');
    }
    logger.info(`Started from path "${path}"`);
    const checkNotifyAppReady = options.codeCheck
    if (typeof checkNotifyAppReady === 'undefined' || checkNotifyAppReady) {
        const isPluginConfigured = searchInDirectory(path, 'notifyAppReady')
        if (!isPluginConfigured) {
            logger.error(`notifyAppReady() is missing in the source code. see: https://capgo.app/docs/plugin/api/#notifyappready`);
            program.error('');
        }
        const foundIndex = checkIndexPosition(path);
        if (!foundIndex) {            
            logger.error(`index.html is missing in the root folder or in the only folder in the root folder`);
            program.error('');
        }
    }
    const zip = new AdmZip();
    zip.addLocalFolder(path);
    const zipped = zip.toBuffer();
    logger.info(`Zipped ${zipped.byteLength} bytes`);
    const s = logger.spinner()
    s.start(`Calculating checksum`);
    const checksum = await getChecksum(zipped, 'crc32');
    s.stop(`Checksum: ${checksum}`);
    const mbSize = Math.floor(zipped.byteLength / 1024 / 1024);
    // We do not issue this warning for json
    if (mbSize > alertMb) {
        logger.warning(`WARNING !!\nThe app size is ${mbSize} Mb, this may take a while to download for users\n`);
        logger.warning(`Learn how to optimize your assets https://capgo.app/blog/optimise-your-images-for-updates/\n`);
        await snag.track({
            channel: 'app-error',
            event: 'App Too Large',
            icon: '🚛',
            tags: {
                'app-id': appId,
            },
            notify: false,
        }).catch()
    }
    const s2 = logger.spinner()
    const name = options.name || `${appId}_${bundle}.zip`
    s2.start(`Saving to ${name}`);
    writeFileSync(name, zipped);
    s2.stop(`Saved to ${name}`);

    logger.printJson({
        bundle,
        filename: name,
        checksum,
    });

    await snag.track({
        channel: 'app',
        event: 'App zip',
        icon: '⏫',
        tags: {
            'app-id': appId,
        },
        notify: false,
    }).catch()

    logger.outro(`Done ✅`);
    process.exit()
}
