import AdmZip from 'adm-zip';
import { program } from 'commander';
import { randomUUID } from 'crypto';
import * as p from '@clack/prompts';
import { checksum as getChecksum } from '@tomasklaen/checksum';
import { writeFileSync } from 'fs';
import { checkLatest } from '../api/update';
import { OptionsBase } from '../api/utils';
import {
    getConfig,
    useLogSnag,
    regexSemver,
} from '../utils';

const alertMb = 20;

interface Options extends OptionsBase {
    bundle?: string
    path?: string
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
        await snag.publish({
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
    s2.start(`Saving to ${appId}_${bundle}.zip`);
    writeFileSync(`${appId}_${bundle}.zip`, zipped);
    s2.stop(`Saved to ${appId}_${bundle}.zip`);
    await snag.publish({
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