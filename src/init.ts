import { readFileSync, writeFileSync } from 'node:fs'
import type { ExecSyncOptions } from 'node:child_process'
import { execSync, spawnSync } from 'node:child_process'
import process from 'node:process'
import * as p from '@clack/prompts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type LogSnag from 'logsnag'
import semver from 'semver'
import type { Database } from './types/supabase.types'
import { markSnag, waitLog } from './app/debug'
import { createKey } from './key'
import { addChannel } from './channel/add'
import { uploadBundle } from './bundle/upload'
import { doLoginExists, login } from './login'
import { addApp } from './app/add'
import { checkLatest } from './api/update'
import type { Options } from './api/app'
import { convertAppName, createSupabaseClient, findBuildCommandForProjectType, findMainFile, findMainFileForProjectType, findProjectType, findSavedKey, getConfig, getPMAndCommand, useLogSnag, verifyUser } from './utils'

interface SuperOptions extends Options {
  local: boolean
}
const importInject = 'import { CapacitorUpdater } from \'@capgo/capacitor-updater\''
const codeInject = 'CapacitorUpdater.notifyAppReady()'
// create regex to find line who start by 'import ' and end by ' from '
const regexImport = /import.*from.*/g
const defaultChannel = 'production'
const execOption = { stdio: 'pipe' }

async function cancelCommand(command: boolean | symbol, userId: string, snag: LogSnag) {
  if (p.isCancel(command)) {
    await markSnag('onboarding-v2', userId, snag, 'canceled', '🤷')
    process.exit()
  }
}

async function markStep(userId: string, snag: LogSnag, step: number | string) {
  return markSnag('onboarding-v2', userId, snag, `onboarding-step-${step}`)
}

async function step2(userId: string, snag: LogSnag, appId: string, options: SuperOptions) {
  const pm = getPMAndCommand()
  const doAdd = await p.confirm({ message: `Add ${appId} in Capgo?` })
  await cancelCommand(doAdd, userId, snag)
  if (doAdd) {
    const s = p.spinner()
    s.start(`Running: ${pm.runner} @capgo/cli@latest app add ${appId}`)
    const addRes = await addApp(appId, options, false)
    if (!addRes)
      s.stop(`App already add ✅`)
    else
      s.stop(`App add Done ✅`)
  }
  else {
    p.log.info(`Run yourself "${pm.runner} @capgo/cli@latest app add ${appId}"`)
  }
  await markStep(userId, snag, 2)
}

async function step3(userId: string, snag: LogSnag, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doChannel = await p.confirm({ message: `Create default channel ${defaultChannel} for ${appId} in Capgo?` })
  await cancelCommand(doChannel, userId, snag)
  if (doChannel) {
    const s = p.spinner()
    // create production channel public
    s.start(`Running: ${pm.runner} @capgo/cli@latest channel add ${defaultChannel} ${appId} --default`)
    const addChannelRes = await addChannel(defaultChannel, appId, {
      default: true,
      apikey,
    }, false)
    if (!addChannelRes)
      s.stop(`Channel already added ✅`)
    else
      s.stop(`Channel add Done ✅`)
  }
  else {
    p.log.info(`Run yourself "${pm.runner} @capgo/cli@latest channel add ${defaultChannel} ${appId} --default"`)
  }
  await markStep(userId, snag, 3)
}

const urlMigrateV6 = 'https://capacitorjs.com/docs/updating/6-0'
const urlMigrateV5 = 'https://capacitorjs.com/docs/updating/5-0'
async function step4(userId: string, snag: LogSnag, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doInstall = await p.confirm({ message: `Automatic Install "@capgo/capacitor-updater" dependency in ${appId}?` })
  await cancelCommand(doInstall, userId, snag)
  if (doInstall) {
    const s = p.spinner()
    s.start(`Checking if @capgo/capacitor-updater is installed`)
    let versionToInstall = 'latest'
    const pack = JSON.parse(readFileSync('package.json').toString())
    let coreVersion = pack.dependencies['@capacitor/core'] || pack.devDependencies['@capacitor/core']
    coreVersion = coreVersion?.replace('^', '').replace('~', '')
    if (!coreVersion) {
      s.stop('Error')
      p.log.warn(`Cannot find @capacitor/core in package.json, please run \`capgo init\` in a capacitor project`)
      p.outro(`Bye 👋`)
      process.exit()
    }
    else if (semver.lt(coreVersion, '5.0.0')) {
      s.stop('Error')
      p.log.warn(`@capacitor/core version is ${coreVersion}, please update to Capacitor v5 first: ${urlMigrateV5}`)
      p.outro(`Bye 👋`)
      process.exit()
    }
    else if (semver.lt(coreVersion, '6.0.0')) {
      s.stop(`@capacitor/core version is ${coreVersion}, please update to Capacitor v6: ${urlMigrateV6} to access the best features of Capgo`)
      versionToInstall = '^5.0.0'
    }
    if (pm.pm === 'unknown') {
      s.stop('Error')
      p.log.warn(`Cannot reconize package manager, please run \`capgo init\` in a capacitor project with npm, pnpm, bun or yarn`)
      p.outro(`Bye 👋`)
      process.exit()
    }
    // // use pm to install capgo
    // // run command pm install @capgo/capacitor-updater@latest
    //  check if capgo is already installed in package.json
    if (pack.dependencies['@capgo/capacitor-updater']) {
      s.stop(`Capgo already installed ✅`)
    }
    else {
      await execSync(`${pm.installCommand} @capgo/capacitor-updater@${versionToInstall}`, execOption as ExecSyncOptions)
      s.stop(`Install Done ✅`)
    }
  }
  else {
    p.log.info(`Run yourself "${pm.installCommand} @capgo/capacitor-updater@latest"`)
  }
  await markStep(userId, snag, 4)
}

async function step5(userId: string, snag: LogSnag, apikey: string, appId: string) {
  const doAddCode = await p.confirm({ message: `Automatic Add "${codeInject}" code and import in ${appId}?` })
  await cancelCommand(doAddCode, userId, snag)
  if (doAddCode) {
    const s = p.spinner()
    s.start(`Adding @capacitor-updater to your main file`)
    const projectType = await findProjectType()
    let mainFilePath
    if (projectType === 'unknown')
      mainFilePath = await findMainFile()
    else
      mainFilePath = await findMainFileForProjectType(projectType)

    if (!mainFilePath) {
      s.stop('Error')
      p.log.warn('Cannot find main file, You need to add @capgo/capacitor-updater manually')
      p.outro(`Bye 👋`)
      process.exit()
    }
    // open main file and inject codeInject
    const mainFile = readFileSync(mainFilePath)
    // find the last import line in the file and inject codeInject after it
    const mainFileContent = mainFile.toString()
    const matches = mainFileContent.match(regexImport)
    const last = matches?.pop()
    if (!last) {
      s.stop('Error')
      p.log.warn(`Cannot find import line in main file, use manual installation: https://capgo.app/docs/plugin/installation/`)
      p.outro(`Bye 👋`)
      process.exit()
    }

    if (mainFileContent.includes(codeInject)) {
      s.stop(`Code already added to ${mainFilePath} ✅`)
    }
    else {
      const newMainFileContent = mainFileContent.replace(last, `${last}\n${importInject};\n\n${codeInject};\n`)
      writeFileSync(mainFilePath, newMainFileContent)
      s.stop(`Code added to ${mainFilePath} ✅`)
    }
    await markStep(userId, snag, 5)
  }
  else {
    p.log.info(`Add to your main file the following code:\n\n${importInject};\n\n${codeInject};\n`)
  }
}

async function step6(userId: string, snag: LogSnag, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doEncrypt = await p.confirm({ message: `Automatic configure end-to-end encryption in ${appId} updates?` })
  await cancelCommand(doEncrypt, userId, snag)
  if (doEncrypt) {
    const s = p.spinner()
    s.start(`Running: ${pm.runner} @capgo/cli@latest key create`)
    const keyRes = await createKey({ force: true }, false)
    if (!keyRes) {
      s.stop('Error')
      p.log.warn(`Cannot create key ❌`)
      p.outro(`Bye 👋`)
      process.exit(1)
    }
    else {
      s.stop(`key created 🔑`)
    }
    markSnag('onboarding-v2', userId, snag, 'Use encryption')
  }
  await markStep(userId, snag, 6)
}

async function step7(userId: string, snag: LogSnag, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doBuild = await p.confirm({ message: `Automatic build ${appId} with "${pm.pm} run build" ?` })
  await cancelCommand(doBuild, userId, snag)
  if (doBuild) {
    const s = p.spinner()
    const projectType = await findProjectType()
    const buildCommand = await findBuildCommandForProjectType(projectType)
    s.start(`Running: ${pm.pm} run ${buildCommand} && ${pm.runner} cap sync`)
    const pack = JSON.parse(readFileSync('package.json').toString())
    // check in script build exist
    if (!pack.scripts[buildCommand]) {
      s.stop('Error')
      p.log.warn(`Cannot find ${buildCommand} script in package.json, please add it and run \`capgo init\` again`)
      p.outro(`Bye 👋`)
      process.exit()
    }
    execSync(`${pm.pm} run ${buildCommand} && ${pm.runner} cap sync`, execOption as ExecSyncOptions)
    s.stop(`Build & Sync Done ✅`)
  }
  else {
    p.log.info(`Build yourself with command: ${pm.pm} run build && ${pm.runner} cap sync`)
  }
  await markStep(userId, snag, 7)
}

async function step8(userId: string, snag: LogSnag, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doBundle = await p.confirm({ message: `Automatic upload ${appId} bundle to Capgo?` })
  await cancelCommand(doBundle, userId, snag)
  if (doBundle) {
    const s = p.spinner()
    s.start(`Running: ${pm.runner} @capgo/cli@latest bundle upload`)
    const uploadRes = await uploadBundle(appId, {
      channel: defaultChannel,
      apikey,
    }, false)
    if (!uploadRes) {
      s.stop('Error')
      p.log.warn(`Upload failed ❌`)
      p.outro(`Bye 👋`)
      process.exit()
    }
    else {
      s.stop(`Upload Done ✅`)
    }
  }
  else {
    p.log.info(`Upload yourself with command: ${pm.runner} @capgo/cli@latest bundle upload`)
  }
  await markStep(userId, snag, 8)
}

async function step9(userId: string, snag: LogSnag) {
  const pm = getPMAndCommand()
  const doRun = await p.confirm({ message: `Run in device now ?` })
  await cancelCommand(doRun, userId, snag)
  if (doRun) {
    const plaformType = await p.select({
      message: 'Pick a platform to run your app',
      options: [
        { value: 'ios', label: 'IOS' },
        { value: 'android', label: 'Android' },
      ],
    })
    if (p.isCancel(plaformType)) {
      p.outro(`Bye 👋`)
      process.exit()
    }

    const platform = plaformType as 'ios' | 'android'
    const s = p.spinner()
    s.start(`Running: ${pm.runner} cap run ${platform}`)
    await spawnSync(pm.runner, ['cap', 'run', platform], { stdio: 'inherit' })
    s.stop(`Started Done ✅`)
  }
  else {
    p.log.info(`Run yourself with command: ${pm.runner} cap run <ios|android>`)
  }
  await markStep(userId, snag, 9)
}

async function step10(userId: string, snag: LogSnag, supabase: SupabaseClient<Database>, appId: string) {
  const doRun = await p.confirm({ message: `Automatic check if update working in device ?` })
  await cancelCommand(doRun, userId, snag)
  if (doRun) {
    p.log.info(`Wait logs sent to Capgo from ${appId} device, Put the app in background and open it again.`)
    p.log.info('Waiting...')
    await waitLog('onboarding-v2', supabase, appId, snag, userId)
  }
  else {
    const appIdUrl = convertAppName(appId)
    p.log.info(`Check logs in https://web.capgo.app/app/p/${appIdUrl}/logs to see if update works.`)
  }
  await markStep(userId, snag, 10)
}

export async function initApp(apikeyCommand: string, appId: string, options: SuperOptions) {
  const pm = getPMAndCommand()
  p.intro(`Capgo onboarding 🛫`)
  await checkLatest()
  const snag = useLogSnag()
  const config = await getConfig()
  appId = appId || config?.app?.appId
  const apikey = apikeyCommand || findSavedKey()

  const log = p.spinner()
  if (!doLoginExists() || apikeyCommand) {
    log.start(`Running: ${pm.runner} @capgo/cli@latest login ***`)
    await login(apikey, options, false)
    log.stop('Login Done ✅')
  }

  const supabase = await createSupabaseClient(apikey)
  const userId = await verifyUser(supabase, apikey, ['upload', 'all', 'read', 'write'])
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
  p.log.info(`Welcome onboard ✈️!`)
  p.log.info(`Your Capgo update system is setup`)
  p.log.info(`Next time use \`${pm.runner} @capgo/cli@latest bundle upload\` to only upload your bundle`)
  p.outro(`Bye 👋`)
  process.exit()
}
