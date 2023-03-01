import AdmZip from 'adm-zip';
import { program } from 'commander';
import { randomUUID } from 'crypto';
import cliProgress from 'cli-progress';
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
    // check if bundle is valid 
    if (!regexSemver.test(bundle)) {
        program.error(`Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`);
    }
    path = path || config?.app?.webDir
    if (!appId || !bundle || !path) {
        program.error("Missing argument, you need to provide a appId and a bundle and a path, or be in a capacitor project");
    }
    console.log(`Zip ${appId}@${bundle} started from path "${path}"`);

    const multibar = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true
    }, cliProgress.Presets.shades_grey);

    // add bars
    const b1 = multibar.create(4, 0, {
        format: 'Uploading: [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} Part'
    }, cliProgress.Presets.shades_grey);
    b1.start(4, 0, {
        speed: "N/A"
    });

    b1.increment();
    const zip = new AdmZip();
    zip.addLocalFolder(path);
    const zipped = zip.toBuffer();
    b1.increment();
    const checksum = await getChecksum(zipped, 'crc32');
    const mbSize = Math.floor(zipped.byteLength / 1024 / 1024);
    b1.increment();
    if (mbSize > alertMb) {
        multibar.log(`WARNING !!\nThe app size is ${mbSize} Mb, this may take a while to download for users\n`);
        multibar.log(`Learn how to optimize your assets https://capgo.app/blog/optimise-your-images-for-updates/\n`);
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
    b1.increment();
    writeFileSync(`${appId}_${bundle}.zip`, zipped);
    multibar.stop()
    console.log("Bundle zipped")
    await snag.publish({
        channel: 'app',
        event: 'App zip',
        icon: '⏫',
        tags: {
            'app-id': appId,
        },
        notify: false,
    }).catch()
    console.log(`Checksum: ${checksum}`);
    console.log(`Done ✅`);
    process.exit()
}