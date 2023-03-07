import { writeFileSync, readFileSync } from 'fs';
import { findPackageManagerType } from '@capgo/find-package-manager'
import { execSync, ExecSyncOptions } from 'child_process';
import * as p from '@clack/prompts';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'types/supabase.types';
import { createKey } from './key';
import { addChannel } from './channel/add';
import { uploadBundle } from './bundle/upload';
import { login } from './login';
import { addApp } from './app/add';
import { checkLatest } from './api/update';
import { Options } from './api/app';
import { convertAppName, createSupabaseClient, findMainFile, findSavedKey, getConfig } from './utils';

interface SuperOptions extends Options {
    local: boolean;
}
const importInject = "import { CapacitorUpdater } from '@capgo/capacitor-updater'";
const codeInject = 'CapacitorUpdater.notifyAppReady()'
// create regex to find line who start by 'import ' and end by ' from '
const regexImport = /import.*from.*/g
const defaultChannel = 'production'
const execOption = { stdio: 'pipe' }

const waitLog = (supabase: SupabaseClient<Database>, appId: string) =>
    new Promise<Database['public']['Tables']['stats']['Row']>((resolve) => {
        console.log('wait log', appId)
        const listener = supabase
            .channel('table-db-changes')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'stats',
                    filter: `app_id=eq.${appId}`,
                },
                (payload) => {
                    console.log('payload', payload)
                    listener.unsubscribe()
                    resolve(payload.new as Database['public']['Tables']['stats']['Row'])
                },
            )
            .subscribe()
    })

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
    const supabase = createSupabaseClient(apikey || findSavedKey())

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

    const doChannel = await p.confirm({ message: `Create default channel ${defaultChannel} for ${appId} in Capgo?` });
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

    const doInstall = await p.confirm({ message: `Automatic Install "@capgo/capacitor-updater" in ${appId}?` });
    if (p.isCancel(doInstall)) {
        process.exit()
    }
    if (doInstall) {
        const s = p.spinner();
        s.start(`Checking if @capgo/capacitor-updater is installed`);
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

    const doAddCode = await p.confirm({ message: `Automatic Add "${codeInject}" code and import in ${appId}?` });
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

    const doEncrypt = await p.confirm({ message: `Automatic configure end-to-end encryption in ${appId} updates?` });
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
    const doBuild = await p.confirm({ message: `Automatic build ${appId} with "npm run build" ?` });
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

    const doBundle = await p.confirm({ message: `Automatic upload ${appId} bundle to Capgo?` });
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
    const doRun = await p.confirm({ message: `Verify update work in device now ?` });
    if (p.isCancel(doRun)) {
        process.exit()
    }
    if (doRun) {
        const plaformType = await p.select({
            message: 'Pick a platform to run your app',
            options: [
                { value: 'ios', label: 'IOS' },
                { value: 'android', label: 'Android' },
            ],
        });
        if (p.isCancel(plaformType)) {
            process.exit()
        }
        const platform = plaformType as 'ios' | 'android'
        const s = p.spinner();
        s.start(`Running: npx cap open ${platform}`);
        await execSync(`npx cap open ${platform}`)
        s.stop(`Started Done ✅\nOpen your device and wait for update`);
        // const s2 = p.spinner();
        // s2.start(`Wait logs send to Capgo from ${appId}`);
        // let loop = true;
        // while (loop) {
        //     console.log('waiting for logs')
        //     const res = await waitLog(supabase, appId);
        //     if (res.action === 'get') {
        //         s2.stop(`Logs received your device received his update ✅`);
        //         loop = false;
        //     } else {
        //         console.log('received ', res.action)
        //     }
        // }
    }
    p.outro(`Welcome onboard ✈️!`);
    const appIdUrl = convertAppName(appId)
    console.log(`Your Capgo update system is setup, check logs in https://web.capgo.app/app/p/${appIdUrl}/logs`)
    process.exit()
}
