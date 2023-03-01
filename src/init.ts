import { writeFileSync, readFileSync } from 'fs';
import { findPackageManagerType } from '@capgo/find-package-manager'
import { execSync, ExecSyncOptions } from 'child_process';
import * as p from '@clack/prompts';
import { createKey } from './key';
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
const importInject = "import { CapacitorUpdater } from '@capgo/capacitor-updater'";
const codeInject = 'CapacitorUpdater.notifyAppReady()'
// create regex to find line who start by 'import ' and end by ' from '
const regexImport = /import.*from.*/g
const defaultChannel = 'production'
const execOption = { stdio: 'pipe' }

export const initApp = async (apikey: string, appId: string, options: SuperOptions) => {
    await checkLatest();
    const config = await getConfig();
    appId = appId || config?.app?.appId

    p.intro(`Capgo init`);

    const log = p.spinner();
    log.start('Running: npx @capgo/cli@latest login ***');
    const loginRes = await login(apikey, options, false);
    if (!loginRes) {
        log.stop('Login already done ✅');
    } else {
        log.stop('Login Done ✅');
    }

    const doAdd = await p.confirm({ message: `Add ${appId} in Capgo?` });
    if (p.isCancel(doAdd)) {
        process.exit()
    }
    if (doAdd) {
        const s = p.spinner();
        s.start(`Running: npx @capgo/cli@latest app add ${appId}`);
        const addRes = await addApp(appId, options, false);
        if (!addRes) {
            s.stop(`App already add ✅`);
        } else {
            s.stop(`App add Done ✅`);
        }
    }

    const doChannel = await p.confirm({ message: `Create channel ${defaultChannel} in Capgo?` });
    if (p.isCancel(doChannel)) {
        process.exit()
    }
    if (doChannel) {
        const s = p.spinner();
        // create production channel public
        s.start(`Running: npx @capgo/cli@latest channel add ${defaultChannel} ${appId} -d`);
        const addChannelRes = await addChannel(defaultChannel, appId, {
            default: true,
            apikey,
        }, false);
        if (!addChannelRes) {
            s.stop(`Channel already added ✅`);
        } else {
            s.stop(`Channel add Done ✅`);
        }
    }

    const doInstall = await p.confirm({ message: `Create key for ${appId} in Capgo?` });
    if (p.isCancel(doInstall)) {
        process.exit()
    }
    if (doInstall) {
        const s = p.spinner();
        s.start(`Checking if capgo is installed`);
        const pack = JSON.parse(readFileSync('package.json').toString());
        const pm = findPackageManagerType();
        if (pm === 'unknown') {
            s.stop(`Cannot reconize package manager, please run \`capgo init\` in a capacitor project with npm, pnpm or yarn`)
            process.exit()
        }
        // // use pm to install capgo
        // // run command pm install @capgo/capacitor-updater@latest
        const installCmd = pm === 'yarn' ? 'add' : 'install'
        //  check if capgo is already installed in package.json
        if (pack.dependencies['@capgo/capacitor-updater']) {
            s.stop(`Capgo already installed ✅`)
        }
        else {
            await execSync(`${pm} ${installCmd} @capgo/capacitor-updater@latest`, execOption as ExecSyncOptions)
            s.stop(`Install Done ✅`);
        }
    }

    const doAddCode = await p.confirm({ message: `Build the project?` });
    if (p.isCancel(doAddCode)) {
        process.exit()
    }
    if (doAddCode) {
        const s = p.spinner();
        s.start(`Adding @capacitor-updater to your main file`);
        const mainFilePath = await findMainFile();
        if (!mainFilePath) {
            s.stop('No main.ts, main.js, index.ts or index.js file found, please run cap init first');
            process.exit()
        }
        // open main file and inject codeInject
        const mainFile = readFileSync(mainFilePath);
        // find the last import line in the file and inject codeInject after it
        const mainFileContent = mainFile.toString();
        const matches = mainFileContent.match(regexImport);
        const last = matches?.pop();
        if (!last) {
            s.stop(`Cannot find import line in main file, use manual installation: https://docs.capgo.app/plugin/installation`)
            process.exit()
        }

        if (mainFileContent.includes(codeInject)) {
            s.stop(`Code already added to ${mainFilePath} ✅`)
        } else {
            const newMainFileContent = mainFileContent.replace(last, `${last}\n${importInject};\n\n${codeInject};\n`)
            writeFileSync(mainFilePath, newMainFileContent);
            s.stop(`Code added to ${mainFilePath} ✅`);
        }
    }

    const doEncrypt = await p.confirm({ message: 'Use end-to-end encryption?' });
    if (p.isCancel(doEncrypt)) {
        process.exit()
    }
    if (doEncrypt) {
        const s = p.spinner();
        s.start(`Running: npx @capgo/cli@latest key create`);
        const keyRes = await createKey({}, false);
        if (!keyRes) {
            s.stop(`Cannot create key ❌`);
            process.exit(1)
        } else {
            s.stop(`key created 🔑`);
        }
    }
    const doBuild = await p.confirm({ message: 'Build the project?' });
    if (p.isCancel(doBuild)) {
        process.exit()
    }
    if (doBuild) {
        const s = p.spinner();
        s.start(`Running: npm run build && npx cap sync`);
        const pack = JSON.parse(readFileSync('package.json').toString());
        // check in script build exist
        if (!pack.scripts?.build) {
            s.stop(`Cannot find build script in package.json, please add it and run \`capgo init\` again`)
            process.exit()
        }
        execSync(`npm run build && npx cap sync`, execOption as ExecSyncOptions)
        s.stop(`Build & Sync Done ✅`);
    }

    const doBundle = await p.confirm({ message: 'Upload the bundle?' });
    if (p.isCancel(doBundle)) {
        process.exit()
    }
    if (doBundle) {
        const s = p.spinner();
        s.start(`Running: npx @capgo/cli@latest bundle upload`);
        const uploadRes = await uploadBundle(appId, {
            channel: defaultChannel,
            apikey,
        }, false);
        if (!uploadRes) {
            s.stop(`Upload failed ❌`);
            process.exit()
        } else {
            s.stop(`Upload Done ✅`);
        }
    }
    p.outro(`You're all set ✅!`);
    console.log(`Now run the app in your phone or emulator with: npx cap run`)
    const appIdUrl = appId.replace(/\./g, '--')
    console.log(`Then watch logs in https://web.capgo.app/app/p/${appIdUrl}/logs`)
    process.exit()
}
