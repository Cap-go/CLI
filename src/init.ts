import { writeFileSync, readFileSync } from 'fs';
import { findPackageManagerType } from '@capgo/find-package-manager'
import { execSync } from 'child_process';
import { addChannel } from './channel/add';
import { uploadBundle } from './bundle/upload';
import { login } from './login';
import { addApp } from './app/add';
import { checkLatest } from './api/update';
import { Options } from './api/app';
import { findMainFile, getConfig } from './utils';

interface SuperOptions extends Options {
    local: boolean;
}
const importInject = "import { CapacitorUpdater } from '@capgo/capacitor-updater';";
const codeInject = 'CapacitorUpdater.notifyAppReady();'
// create regex to find line who start by 'import ' and end by ' from '
const regexImport = /import.*from.*/g
const defaultChannel = 'production'

export const initApp = async (apikey: string, appId: string, options: SuperOptions) => {
    await checkLatest();
    const config = await getConfig();
    appId = appId || config?.app?.appId

    const pm = findPackageManagerType();
    if (pm === 'unknown') {
        console.log(`Cannot reconize package manager, please run \`capgo init\` in a capacitor project with npm, pnpm or yarn`)
        process.exit()
    }
    const mainFilePath = await findMainFile();
    const pack = JSON.parse(readFileSync('package.json').toString());
    // check in script build exist
    if (!pack.scripts?.build) {
        console.log(`Cannot find build script in package.json, please add it and run \`capgo init\` again`)
        process.exit()
    }

    console.log(`Running: npx @capgo/cli@latest login ***`);
    const loginRes = await login(apikey, options, false);
    if (!loginRes) {
        console.log(`Login already done ✅`);
    } else {
        console.log(`Login Done ✅`);
    }

    console.log(`Running: npx @capgo/cli@latest app add ${appId}`);
    const addRes = await addApp(appId, options, false);
    if (!addRes) {
        console.log(`App already add ✅`);
    } else {
        console.log(`App add Done ✅`);
    }

    // create production channel public
    console.log(`Running: npx @capgo/cli@latest channel add ${defaultChannel} ${appId} -d`);
    const addChannelRes = await addChannel(defaultChannel, appId, {
        default: true,
        apikey,
    }, false);
    if (!addChannelRes) {
        console.log(`Channel already added ✅`);
    } else {
        console.log(`Channel add Done ✅`);
    }

    // // use pm to install capgo
    // // run command pm install @capgo/capacitor-updater@latest
    const installCmd = pm === 'yarn' ? 'add' : 'install'
    //  check if capgo is already installed in package.json
    if (pack.dependencies['@capgo/capacitor-updater']) {
        console.log(`Capgo already installed ✅`)
    }
    else {
        const res = await execSync(`${pm} ${installCmd} @capgo/capacitor-updater@latest`)
        console.log(res.toString())
        console.log(`Install Done ✅`);
    }

    // open main file and inject codeInject
    const mainFile = readFileSync(mainFilePath);
    // find the last import line in the file and inject codeInject after it
    const mainFileContent = mainFile.toString();
    const matches = mainFileContent.match(regexImport);
    const last = matches?.pop();
    if (!last) {
        console.log(`Cannot find import line in main file, use manual installation: https://docs.capgo.app/installation`)
        process.exit()
    }

    if (mainFileContent.includes(codeInject)) {
        console.log(`Code already added to ${mainFilePath} ✅`)
    } else {
        const newMainFileContent = mainFileContent.replace(last, `${last}\n${importInject}\n\n${codeInject}\n`)
        writeFileSync(mainFilePath, newMainFileContent);
        console.log(`Code added to ${mainFilePath} ✅`);
    }

    console.log(`Running: npm run build && npx cap sync`);
    const res2 = await execSync(`npm run build && npx cap sync`)
    console.log(res2.toString())
    console.log(`Build & Sync Done ✅`);

    console.log(`Running: npx @capgo/cli@latest bundle upload`);
    const uploadRes = await uploadBundle(appId, {
        channel: defaultChannel,
        apikey,
    }, false);
    if (!uploadRes) {
        console.log(`Upload failed ❌`);
        process.exit()
    } else {
        console.log(`Upload Done ✅`);
    }

    console.log(`Init Done ✅`);
    console.log(`Now run the app in your phone or emulator with: npx cap run`)
    const appIdUrl = appId.replace(/\./g, '--')
    console.log(`Then watch logs in https://web.capgo.app/app/p/${appIdUrl}/logs`)
    process.exit()
}
