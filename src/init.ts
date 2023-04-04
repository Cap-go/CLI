import { writeFileSync, readFileSync } from 'fs';
import { findPackageManagerType } from '@capgo/find-package-manager'
import { execSync, ExecSyncOptions, spawnSync } from 'child_process';
import * as p from '@clack/prompts';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'types/supabase.types';
import LogSnag from 'logsnag';
import { createKey } from './key';
import { addChannel } from './channel/add';
import { uploadBundle } from './bundle/upload';
import { login } from './login';
import { addApp } from './app/add';
import { checkLatest } from './api/update';
import { Options } from './api/app';
import { convertAppName, createSupabaseClient, findMainFile, findSavedKey, getConfig, useLogSnag, verifyUser } from './utils';

interface SuperOptions extends Options {
    local: boolean;
}
const importInject = "import { CapacitorUpdater } from '@capgo/capacitor-updater'";
const codeInject = 'CapacitorUpdater.notifyAppReady()'
// create regex to find line who start by 'import ' and end by ' from '
const regexImport = /import.*from.*/g
const defaultChannel = 'production'
const execOption = { stdio: 'pipe' }

const cancelCommand = async (command: boolean | symbol, userId: string, snag: LogSnag) => {
    if (p.isCancel(command)) {
        await snag.publish({
            channel: 'onboarding-v2',
            event: 'canceled',
            icon: '🤷',
            tags: {
                'user-id': userId,
            },
            notify: false,
        }).catch()
        process.exit()
    }
}

const markSnag = async (userId: string, snag: LogSnag, event: string, icon = '✅') => {
    await snag.publish({
        channel: 'onboarding-v2',
        event,
        icon,
        tags: {
            'user-id': userId,
        },
        notify: false,
    }).catch()
}

const markStep = async (userId: string, snag: LogSnag, step: number | string) => markSnag(userId, snag, `onboarding-step-${step}`)


const wait = (ms: number) => new Promise(resolve => { setTimeout(resolve, ms) })

const waitLog = async (supabase: SupabaseClient<Database>, appId: string, snag: LogSnag, userId: string) => {
    let loop = true
    let now = new Date().toISOString()
    await markSnag(userId, snag, 'Use waitlog')
    while (loop) {
        const { data, error } = await supabase
            .from('stats')
            .select('*')
            .eq('app_id', appId)
            .order('id', { ascending: false })
            .gte('created_at', now)
            .limit(1)
            .single()
        if (data && !error) {
            p.log.info(`Device: ${data.device_id}`)
            if (data.action === 'get') {
                p.log.info('Update Sent your your device, wait until event download complete')
                await markStep(userId, snag, 11)
            }
            else if (data.action.startsWith('download_')) {
                const action = data.action.split('_')[1]
                if (action === 'complete') {
                    p.log.info('Your bundle has been downloaded on your device, background the app now and open it again to see the update')
                    await markStep(userId, snag, 12)
                }
                else if (action === 'fail') {
                    p.log.error('Your bundle has failed to download on your device.')
                    p.log.error('Please check if you have network connection and try again')
                }
                else {
                    p.log.info(`Your bundle is downloading ${action}% ...`)
                }
            }
            else if (data.action === 'set') {
                p.log.info('Your bundle has been set on your device ❤️')
                loop = false
                await markStep(userId, snag, 13)
                return Promise.resolve(data)
            }
            else if (data.action === 'NoChannelOrOverride') {
                p.log.error('No default channel or override (channel/device) found, please create one')
            }
            else if (data.action === 'needPlanUpgrade') {
                p.log.error('Your are out of quota, please upgrade your plan')
            }
            else if (data.action === 'missingBundle') {
                p.log.error('Your bundle is missing, please check how you build your app')
            }
            else if (data.action === 'noNew') {
                p.log.error(`Your version in ${data.platform} is the same as your version uploaded, change it to see the update`)
            }
            else if (data.action === 'disablePlatformIos') {
                p.log.error('iOS is disabled  in the default channel and your device is an iOS device')
            }
            else if (data.action === 'disablePlatformAndroid') {
                p.log.error('Android is disabled  in the default channel and your device is an Android device')
            }
            else if (data.action === 'disableAutoUpdateToMajor') {
                p.log.error('Auto update to major version is disabled in the default channel.')
                p.log.error('Set your app to the same major version as the default channel')
            }
            else if (data.action === 'disableAutoUpdateUnderNative') {
                p.log.error('Auto update under native version is disabled in the default channel.')
                p.log.error('Set your app to the same native version as the default channel.')
            }
            else if (data.action === 'disableDevBuild') {
                p.log.error('Dev build is disabled in the default channel.')
                p.log.error('Set your channel to allow it if you wanna test your app')
            }
            else if (data.action === 'disableEmulator') {
                p.log.error('Emulator is disabled in the default channel.')
                p.log.error('Set your channel to allow it if you wanna test your app')
            }
            else if (data.action === 'cannotGetBundle') {
                p.log.error('We cannot get your bundle from the default channel.')
                p.log.error('Are you sure your default channel has a bundle set?')
            }
            else if (data.action === 'set_fail') {
                p.log.error('Your bundle seems to be corrupted, please check your code and send it again to Capgo')
            }
            else if (data.action === 'reset') {
                p.log.error('Your device has been reset to the builtin bundle')
            }
            else if (data.action === 'update_fail') {
                p.log.error('Your bundle has been installed but failed to call notifyAppReady')
                p.log.error('Please check if you have network connection and try again')
            }
            else if (data.action === 'checksum_fail') {
                p.log.error('Your bundle has failed to validate checksum, please check your code and send it again to Capgo')
            }
            now = new Date().toISOString()
        }
        await wait(1000)
    }
    return Promise.resolve()
}
// const waitLog = (supabase: SupabaseClient<Database>, appId: string) =>
//     new Promise<Database['public']['Tables']['stats']['Row']>((resolve) => {
//         console.log('wait log', appId)
//         const listener = supabase
//             .channel('table-db-changes')
//             .on(
//                 'postgres_changes',
//                 {
//                     event: 'INSERT',
//                     schema: 'public',
//                     table: 'stats',
//                     filter: `app_id=eq.${appId}`,
//                 },
//                 (payload) => {
//                     console.log('payload', payload)
//                     if (payload.new.action === 'get') {
//                         console.log('stop listen')
//                         listener.unsubscribe()
//                         resolve(payload.new as Database['public']['Tables']['stats']['Row'])
//                     }
//                 },
//             )
//             .subscribe()
//     })

const step2 = async (userId: string, snag: LogSnag, appId: string, options: SuperOptions) => {
    const doAdd = await p.confirm({ message: `Add ${appId} in Capgo?` });
    await cancelCommand(doAdd, userId, snag);
    if (doAdd) {
        const s = p.spinner();
        s.start(`Running: npx @capgo/cli@latest app add ${appId}`);
        const addRes = await addApp(appId, options, false);
        if (!addRes) {
            s.stop(`App already add ✅`);
        } else {
            s.stop(`App add Done ✅`);
        }
    } else {
        p.log.info(`Run yourself "npx @capgo/cli@latest app add ${appId}"`)
    }
    await markStep(userId, snag, 2)
}

const step3 = async (userId: string, snag: LogSnag,
    apikey: string, appId: string) => {
    const doChannel = await p.confirm({ message: `Create default channel ${defaultChannel} for ${appId} in Capgo?` });
    await cancelCommand(doChannel, userId, snag);
    if (doChannel) {
        const s = p.spinner();
        // create production channel public
        s.start(`Running: npx @capgo/cli@latest channel add ${defaultChannel} ${appId} --default`);
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
    else {
        p.log.info(`Run yourself "npx @capgo/cli@latest channel add ${defaultChannel} ${appId} --default"`)
    }
    await markStep(userId, snag, 3)
}

const step4 = async (userId: string, snag: LogSnag,
    apikey: string, appId: string,) => {

    const doInstall = await p.confirm({ message: `Automatic Install "@capgo/capacitor-updater" dependency in ${appId}?` });
    await cancelCommand(doInstall, userId, snag);
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
    else {
        p.log.info(`Run yourself "npm i @capgo/capacitor-updater@latest"`)
    }
    await markStep(userId, snag, 4)
}

const step5 = async (userId: string, snag: LogSnag,
    apikey: string, appId: string) => {
    const doAddCode = await p.confirm({ message: `Automatic Add "${codeInject}" code and import in ${appId}?` });
    await cancelCommand(doAddCode, userId, snag);
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
        await markStep(userId, snag, 5)
    }
    else {
        p.log.info(`Add to your main file the following code:\n\n${importInject};\n\n${codeInject};\n`)
    }
}

const step6 = async (userId: string, snag: LogSnag,
    apikey: string, appId: string) => {
    const doEncrypt = await p.confirm({ message: `Automatic configure end-to-end encryption in ${appId} updates?` });
    await cancelCommand(doEncrypt, userId, snag);
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
        markSnag(userId, snag, 'Use encryption')
    }
    await markStep(userId, snag, 6)
}

const step7 = async (userId: string, snag: LogSnag,
    apikey: string, appId: string) => {
    const doBuild = await p.confirm({ message: `Automatic build ${appId} with "npm run build" ?` });
    await cancelCommand(doBuild, userId, snag);
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
    } else {
        p.log.info(`Build yourself with command: npm run build && npx cap sync`)
    }
    await markStep(userId, snag, 7)
}

const step8 = async (userId: string, snag: LogSnag,
    apikey: string, appId: string) => {
    const doBundle = await p.confirm({ message: `Automatic upload ${appId} bundle to Capgo?` });
    await cancelCommand(doBundle, userId, snag);
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
    } else {
        p.log.info(`Upload yourself with command: npx @capgo/cli@latest bundle upload`)
    }
    await markStep(userId, snag, 8)
}

const step9 = async (userId: string, snag: LogSnag) => {
    const doRun = await p.confirm({ message: `Run in device now ?` });
    await cancelCommand(doRun, userId, snag);
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
        s.start(`Running: npx cap run ${platform}`);
        await spawnSync('npx', ['cap', 'run', platform], { stdio: 'inherit' });
        s.stop(`Started Done ✅`);
    } else {
        p.log.info(`Run yourself with command: npx cap run <ios|android>`)
    }
    await markStep(userId, snag, 9)
}

const step10 = async (userId: string, snag: LogSnag,
    supabase: SupabaseClient<Database>, appId: string) => {
    const doRun = await p.confirm({ message: `Automatic check if update working in device ?` });
    await cancelCommand(doRun, userId, snag);
    if (doRun) {
        p.log.info(`Wait logs sent to Capgo from ${appId} device, Put the app in background and open it again.`)
        p.log.info('Waiting...');
        await waitLog(supabase, appId, snag, userId);
    } else {
        const appIdUrl = convertAppName(appId)
        p.log.info(`Check logs in https://web.capgo.app/app/p/${appIdUrl}/logs to see if update works.`)
    }
    await markStep(userId, snag, 10)
}

export const initApp = async (apikey: string, appId: string, options: SuperOptions) => {
    await checkLatest();
    const snag = useLogSnag()
    const config = await getConfig();
    appId = appId || config?.app?.appId
    apikey = apikey || findSavedKey()

    p.intro(`Capgo init`);
    const log = p.spinner();
    log.start('Running: npx @capgo/cli@latest login ***');
    const loginRes = await login(apikey, options, false);
    if (!loginRes) {
        log.stop('Login already done ✅');
    } else {
        log.stop('Login Done ✅');
    }
    const supabase = createSupabaseClient(apikey)
    const userId = await verifyUser(supabase, apikey, ['upload', 'all', 'read', 'write']);
    await markStep(userId, snag, 1)

    await step2(userId, snag, appId, options)
    await step3(userId, snag, apikey, appId)
    await step4(userId, snag, apikey, appId)
    await step5(userId, snag, apikey, appId)
    await step6(userId, snag, apikey, appId)
    await step7(userId, snag, apikey, appId)
    await step8(userId, snag, apikey, appId)
    await step9(userId, snag)
    await step10(userId, snag, supabase, appId)

    await markStep(userId, snag, 0)
    p.outro(`Welcome onboard ✈️!\nYour Capgo update system is setup`);
    process.exit()
}
