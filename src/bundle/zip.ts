import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import AdmZip from 'adm-zip';
import { program } from 'commander';
import * as p from '@clack/prompts';
import { checksum as getChecksum } from '@tomasklaen/checksum';
import { checkLatest } from '../api/update';
import { OptionsBase } from '../api/utils';
import {
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
}

export const zipBundle = async (appId: string, options: Options) => {
    await checkLatest();
    let { bundle, path } = options;
    const snag = useLogSnag()

    const config = await getConfig();
    appId = appId || config?.app?.appId
    // create bundle name format : 1.0.0-beta.x where x is a uuid
    const uuid = randomUUID().split('-')[0];
    bundle = bundle || config?.app?.package?.version || `0.0.1-beta.${uuid}`
    p.intro(`Zipping ${appId}@${bundle}`);
    // check if bundle is valid 
    if (!regexSemver.test(bundle)) {
        p.log.error(`Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`);
        program.error('');
    }
    path = path || config?.app?.webDir
    if (!appId || !bundle || !path) {
        p.log.error("Missing argument, you need to provide a appId and a bundle and a path, or be in a capacitor project");
        program.error('');
    }
    p.log.info(`Started from path "${path}"`);
    const checkNotifyAppReady = options.codeCheck 
    if (typeof checkNotifyAppReady === 'undefined' || checkNotifyAppReady) {
        const isPluginConfigured = searchInDirectory(path, 'notifyAppReady')
        if (!isPluginConfigured) {
            p.log.error(`notifyAppReady() is missing in the source code. see: https://capgo.app/docs/plugin/api/#notifyappready`);
            program.error('');
        }
        const foundIndex = checkIndexPosition(path);
        if (!foundIndex) {
            p.log.error(`index.html is missing in the root folder or in the only folder in the root folder`);
            program.error('');
        }
    }
    const zip = new AdmZip();
    zip.addLocalFolder(path);
    const zipped = zip.toBuffer();
    p.log.info(`Zipped ${zipped.byteLength} bytes`);
    const s = p.spinner()
    s.start(`Calculating checksum`);
    const checksum = await getChecksum(zipped, 'crc32');
    s.stop(`Checksum: ${checksum}`);
    const mbSize = Math.floor(zipped.byteLength / 1024 / 1024);
    if (mbSize > alertMb) {
        p.log.warn(`WARNING !!\nThe app size is ${mbSize} Mb, this may take a while to download for users\n`);
        p.log.warn(`Learn how to optimize your assets https://capgo.app/blog/optimise-your-images-for-updates/\n`);
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
    const s2 = p.spinner()
    const name = options.name || `${appId}_${bundle}.zip`
    s2.start(`Saving to ${name}`);
    writeFileSync(name, zipped);
    s2.stop(`Saved to ${name}`);
    await snag.track({
        channel: 'app',
        event: 'App zip',
        icon: '⏫',
        tags: {
            'app-id': appId,
        },
        notify: false,
    }).catch()
    p.outro(`Done ✅`);
    process.exit()
}
