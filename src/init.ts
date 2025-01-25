import type { ExecSyncOptions } from 'node:child_process'
import type { Options } from './api/app'
import type { Organization } from './utils'
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd, exit } from 'node:process'
import { cancel as pCancel, confirm as pConfirm, intro as pIntro, isCancel as pIsCancel, log as pLog, outro as pOutro, select as pSelect, spinner as pSpinner, text as pText } from '@clack/prompts'
import {
  lessThan,
  parse,
} from '@std/semver'
import tmp from 'tmp'
import { checkAlerts } from './api/update'
import { addAppInternal } from './app/add'
import { markSnag, waitLog } from './app/debug'
import { uploadBundle } from './bundle/upload'
import { addChannel } from './channel/add'
import { createKeyV2 } from './keyV2'
import { doLoginExists, login } from './login'
import { convertAppName, createSupabaseClient, findBuildCommandForProjectType, findMainFile, findMainFileForProjectType, findProjectType, findRoot, findSavedKey, getAllPackagesDependencies, getAppId, getConfig, getLocalConfig, getOrganization, getPMAndCommand, projectIsMonorepo, readPackageJson, updateConfig, verifyUser } from './utils'

interface SuperOptions extends Options {
  local: boolean
  supaHost?: string
  supaAnon?: string
}
const importInject = 'import { CapacitorUpdater } from \'@capgo/capacitor-updater\''
const codeInject = 'CapacitorUpdater.notifyAppReady()'
// create regex to find line who start by 'import ' and end by ' from '
const regexImport = /import.*from.*/g
const defaultChannel = 'production'
const execOption = { stdio: 'pipe' }

let tmpObject: tmp.FileResult['name'] | undefined
let globalPathToPackageJson: string | undefined

function readTmpObj() {
  if (!tmpObject) {
    tmpObject = readdirSync(tmp.tmpdir)
      .map((name) => { return { name, full: `${tmp.tmpdir}/${name}` } })
      .find(obj => obj.name.startsWith('capgocli'))
      ?.full
      ?? tmp.fileSync({ prefix: 'capgocli' }).name
  }
}

function markStepDone(step: number, pathToPackageJson?: string) {
  try {
    readTmpObj()
    writeFileSync(tmpObject!, JSON.stringify(pathToPackageJson ? { step_done: step, pathToPackageJson } : { step_done: step, pathToPackageJson: globalPathToPackageJson }))
    if (pathToPackageJson) {
      globalPathToPackageJson = pathToPackageJson
    }
  }
  catch (err) {
    pLog.error(`Cannot mark step as done in the CLI, error:\n${err}`)
    pLog.warn('Onboarding will continue but please report it to the capgo team!')
  }
}

async function readStepsDone(orgId: string, apikey: string): Promise<number | undefined> {
  try {
    readTmpObj()
    const rawData = readFileSync(tmpObject!, 'utf-8')
    if (!rawData || rawData.length === 0)
      return undefined

    const { step_done, pathToPackageJson } = JSON.parse(rawData)
    pLog.info(`You have already got to the step ${step_done}/10 in the previous session`)
    const skipSteps = await pConfirm({ message: 'Would you like to continue from where you left off?' })
    await cancelCommand(skipSteps, orgId, apikey)
    if (skipSteps) {
      if (pathToPackageJson) {
        globalPathToPackageJson = pathToPackageJson
      }
      return step_done
    }

    return undefined
  }
  catch (err) {
    pLog.error(`Cannot read which steps have been compleated, error:\n${err}`)
    pLog.warn('Onboarding will continue but please report it to the capgo team!')
    return undefined
  }
}

function cleanupStepsDone() {
  if (!tmpObject) {
    return
  }

  try {
    rmSync(tmpObject)
  }
  catch (err) {
    pLog.error(`Cannot delete the tmp steps file.\nError: ${err}`)
  }
}

async function cancelCommand(command: boolean | symbol, orgId: string, apikey: string) {
  if (pIsCancel(command)) {
    await markSnag('onboarding-v2', orgId, apikey, 'canceled', '🤷')
    exit()
  }
}

async function markStep(orgId: string, apikey: string, step: number | string) {
  return markSnag('onboarding-v2', orgId, apikey, `onboarding-step-${step}`)
}

async function step2(organization: Organization, apikey: string, appId: string, options: SuperOptions) {
  const pm = getPMAndCommand()
  const doAdd = await pConfirm({ message: `Add ${appId} in Capgo?` })
  await cancelCommand(doAdd, organization.gid, apikey)
  if (doAdd) {
    const s = pSpinner()
    s.start(`Running: ${pm.runner} @capgo/cli@latest app add ${appId}`)
    const addRes = await addAppInternal(appId, options, organization, false)
    if (!addRes)
      s.stop(`App already add ✅`)
    else
      s.stop(`App add Done ✅`)
  }
  else {
    pLog.info(`If you change your mind, run it for yourself with: "${pm.runner} @capgo/cli@latest app add ${appId}"`)
  }
  await markStep(organization.gid, apikey, 2)
}

async function step3(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doChannel = await pConfirm({ message: `Create default channel ${defaultChannel} for ${appId} in Capgo?` })
  await cancelCommand(doChannel, orgId, apikey)
  if (doChannel) {
    const s = pSpinner()
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
    pLog.info(`If you change your mind, run it for yourself with: "${pm.runner} @capgo/cli@latest channel add ${defaultChannel} ${appId} --default"`)
  }
  await markStep(orgId, apikey, 3)
}

async function getAssistedDependencies(stepsDone: number) {
  // here we will assume that getAlllPackagesDependencies uses 'findRoot(cwd())' for the first argument
  const root = join(findRoot(cwd()), 'package.json')
  const dependencies = !globalPathToPackageJson ? await getAllPackagesDependencies(undefined, root) : await getAllPackagesDependencies(undefined, globalPathToPackageJson)
  if (dependencies.size === 0 || !dependencies.has('@capacitor/core')) {
    pLog.warn('No adequate dependencies found')
    const doSelect = await pConfirm({ message: 'Would you like to select the package.json file manually?' })
    if (pIsCancel(doSelect)) {
      pCancel('Operation cancelled.')
      exit(1)
    }
    if (doSelect) {
      const useTreeSelect = await pConfirm({ message: 'Would you like to use a tree selector to choose the package.json file?' })
      if (pIsCancel(useTreeSelect)) {
        pCancel('Operation cancelled.')
        exit(1)
      }

      if (useTreeSelect) {
        let path = cwd()
        let selectedPath = 'package.json' as string | symbol
        while (true) {
          const options = readdirSync(path)
            .map(dir => ({ value: dir, label: dir }))
          options.push({ value: '..', label: '..' })
          selectedPath = await pSelect({
            message: 'Select package.json file:',
            options,
          })
          if (pIsCancel(selectedPath)) {
            pCancel('Operation cancelled.')
            exit(1)
          }
          if (!statSync(join(path, selectedPath)).isDirectory() && selectedPath !== 'package.json') {
            pLog.error(`Selected a file that is not a package.json file`)
            continue
          }
          path = join(path, selectedPath)
          if (selectedPath === 'package.json') {
            break
          }
        }
        // write the path of package.json in tmp file
        await markStepDone(stepsDone, path)
        return { dependencies: await getAllPackagesDependencies(undefined, path), path }
      }
      const path = await pText({
        message: 'Enter path to node_modules folder:',
      }) as string
      if (pIsCancel(path)) {
        pCancel('Operation cancelled.')
        exit(1)
      }
      if (!existsSync(path)) {
        pLog.error(`Path ${path} does not exist`)
        exit(1)
      }
      return { dependencies: await getAllPackagesDependencies(undefined, path), path }
    }
  }

  // even in the default case, let's mark the path to package.json
  // this will help with bundle upload
  await markStepDone(stepsDone, root)
  return { dependencies: await getAllPackagesDependencies(undefined, root), path: root }
}

const urlMigrateV6 = 'https://capacitorjs.com/docs/updating/6-0'
const urlMigrateV5 = 'https://capacitorjs.com/docs/updating/5-0'
async function step4(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doInstall = await pConfirm({ message: `Automatic Install "@capgo/capacitor-updater" dependency in ${appId}?` })
  await cancelCommand(doInstall, orgId, apikey)
  if (doInstall) {
    const s = pSpinner()
    let versionToInstall = 'latest'
    // 3 because this is the 4th step, ergo 3 steps have already been done
    const { dependencies, path } = await getAssistedDependencies(3)
    s.start(`Checking if @capgo/capacitor-updater is installed`)
    if (!dependencies.has('@capacitor/core')) {
      s.stop('Error')
      pLog.warn(`Cannot find @capacitor/core in package.json`)
      pOutro(`Bye 👋`)
      exit()
    }

    const coreVersion = parse(dependencies.get('@capacitor/core')?.replace('^', '').replace('~', '') ?? '')
    if (!coreVersion) {
      s.stop('Error')
      pLog.warn(`Cannot find @capacitor/core in package.json, please run \`capgo init\` in a capacitor project`)
      pOutro(`Bye 👋`)
      exit()
    }
    else if (lessThan(coreVersion, parse('5.0.0'))) {
      s.stop('Error')
      pLog.warn(`@capacitor/core version is ${coreVersion}, please update to Capacitor v5 first: ${urlMigrateV5}`)
      pOutro(`Bye 👋`)
      exit()
    }
    else if (lessThan(coreVersion, parse('6.0.0'))) {
      s.stop(`@capacitor/core version is ${coreVersion}, please update to Capacitor v6: ${urlMigrateV6} to access the best features of Capgo`)
      versionToInstall = '^5.0.0'
    }
    if (pm.pm === 'unknown') {
      s.stop('Error')
      pLog.warn(`Cannot reconize package manager, please run \`capgo init\` in a capacitor project with npm, pnpm, bun or yarn`)
      pOutro(`Bye 👋`)
      exit()
    }
    // // use pm to install capgo
    // // run command pm install @capgo/capacitor-updater@latest
    //  check if capgo is already installed in package.json
    if (dependencies.get('@capgo/capacitor-updater')) {
      s.stop(`Capgo already installed ✅`)
    }
    else {
      await execSync(`${pm.installCommand} @capgo/capacitor-updater@${versionToInstall}`, { ...execOption, cwd: path.replace('/package.json', '') } as ExecSyncOptions)
      const pkg = await readPackageJson(undefined, path)
      await updateConfig({ version: pkg?.version || '1.0.0', appId, autoUpdate: true })
      s.stop(`Install Done ✅`)
    }
  }
  else {
    pLog.info(`If you change your mind, run it for yourself with: "${pm.installCommand} @capgo/capacitor-updater@latest"`)
  }
  await markStep(orgId, apikey, 4)
}

async function step5(orgId: string, apikey: string, appId: string) {
  const doAddCode = await pConfirm({ message: `Automatic Add "${codeInject}" code and import in ${appId}?` })
  await cancelCommand(doAddCode, orgId, apikey)

  if (doAddCode) {
    const s = pSpinner()
    s.start(`Adding @capacitor-updater to your main file`)

    const projectType = await findProjectType()
    if (projectType === 'nuxtjs-js' || projectType === 'nuxtjs-ts') {
      // Nuxt.js specific logic
      const nuxtDir = join('plugins')
      if (!existsSync(nuxtDir)) {
        mkdirSync(nuxtDir, { recursive: true })
      }
      let nuxtFilePath
      if (projectType === 'nuxtjs-ts') {
        nuxtFilePath = join(nuxtDir, 'capacitorUpdater.client.ts')
      }
      else {
        nuxtFilePath = join(nuxtDir, 'capacitorUpdater.client.js')
      }
      const nuxtFileContent = `
        import { CapacitorUpdater } from '@capgo/capacitor-updater'

        export default defineNuxtPlugin(() => {
          CapacitorUpdater.notifyAppReady()
        })
      `
      if (existsSync(nuxtFilePath)) {
        const currentContent = readFileSync(nuxtFilePath, 'utf8')
        if (currentContent.includes('CapacitorUpdater.notifyAppReady()')) {
          s.stop('Code already added to capacitorUpdater.client.ts file inside plugins directory ✅')
          pLog.info('Plugins directory and capacitorUpdater.client.ts file already exist with required code')
        }
        else {
          writeFileSync(nuxtFilePath, nuxtFileContent, 'utf8')
          s.stop('Code added to capacitorUpdater.client.ts file inside plugins directory ✅')
          pLog.info('Updated capacitorUpdater.client.ts file with required code')
        }
      }
      else {
        writeFileSync(nuxtFilePath, nuxtFileContent, 'utf8')
        s.stop('Code added to capacitorUpdater.client.ts file inside plugins directory ✅')
        pLog.info('Created plugins directory and capacitorUpdater.client.ts file')
      }
    }
    else {
      // Handle other project types
      let mainFilePath
      if (projectType === 'unknown') {
        mainFilePath = await findMainFile()
      }
      else {
        const isTypeScript = projectType.endsWith('-ts')
        mainFilePath = await findMainFileForProjectType(projectType, isTypeScript)
      }

      // Open main file and inject codeInject
      if (!mainFilePath || !existsSync(mainFilePath)) {
        s.stop('Cannot find main file to install Updater plugin')
        const userProvidedPath = await pText({
          message: `Provide the correct relative path to your main file (JS or TS):`,
          validate: (value) => {
            if (!existsSync(value))
              return 'File does not exist. Please provide a valid path.'
          },
        })
        if (pIsCancel(userProvidedPath)) {
          pCancel('Operation cancelled.')
          exit(1)
        }
        mainFilePath = userProvidedPath
      }
      const mainFile = readFileSync(mainFilePath, 'utf8')
      const mainFileContent = mainFile.toString()
      const matches = mainFileContent.match(regexImport)
      const last = matches?.pop()

      if (!last) {
        s.stop('Error')
        pLog.warn(`Cannot find import line in main file, use manual installation: https://capgo.app/docs/plugin/cloud-mode/auto-update/`)
        pOutro(`Bye 👋`)
        exit()
      }

      if (mainFileContent.includes(codeInject)) {
        s.stop(`Code already added to ${mainFilePath} ✅`)
      }
      else {
        const newMainFileContent = mainFileContent.replace(last, `${last}\n${importInject};\n\n${codeInject};\n`)
        writeFileSync(mainFilePath, newMainFileContent, 'utf8')
        s.stop(`Code added to ${mainFilePath} ✅`)
      }
    }

    await markStep(orgId, apikey, 5)
  }
  else {
    pLog.info(`Add to your main file the following code:\n\n${importInject};\n\n${codeInject};\n`)
  }
}

async function step6(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doEncrypt = await pConfirm({ message: `Automatic configure end-to-end encryption in ${appId} updates?` })
  await cancelCommand(doEncrypt, orgId, apikey)
  if (doEncrypt) {
    const s = pSpinner()
    s.start(`Running: ${pm.runner} @capgo/cli@latest key create`)
    const keyRes = await createKeyV2({ force: true }, false)
    if (!keyRes) {
      s.stop('Error')
      pLog.warn(`Cannot create key ❌`)
      pOutro(`Bye 👋`)
      exit(1)
    }
    else {
      s.stop(`key created 🔑`)
    }
    markSnag('onboarding-v2', orgId, apikey, 'Use encryption v2')
  }
  await markStep(orgId, apikey, 6)
}

async function step7(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doBuild = await pConfirm({ message: `Automatic build ${appId} with "${pm.pm} run build" ?` })
  await cancelCommand(doBuild, orgId, apikey)
  if (doBuild) {
    const s = pSpinner()
    const projectType = await findProjectType()
    const buildCommand = await findBuildCommandForProjectType(projectType)
    s.start(`Running: ${pm.pm} run ${buildCommand} && ${pm.runner} cap sync`)
    const pack = await readPackageJson()
    // check in script build exist
    if (!pack.scripts[buildCommand]) {
      s.stop('Error')
      pLog.warn(`Cannot find ${buildCommand} script in package.json, please add it and run \`capgo init\` again`)
      pOutro(`Bye 👋`)
      exit()
    }
    execSync(`${pm.pm} run ${buildCommand} && ${pm.runner} cap sync`, execOption as ExecSyncOptions)
    s.stop(`Build & Sync Done ✅`)
  }
  else {
    pLog.info(`Build yourself with command: ${pm.pm} run build && ${pm.runner} cap sync`)
  }
  await markStep(orgId, apikey, 7)
}

async function step8(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doBundle = await pConfirm({ message: `Automatic upload ${appId} bundle to Capgo?` })
  await cancelCommand(doBundle, orgId, apikey)
  if (doBundle) {
    const s = pSpinner()
    let nodeModulesPath: string | undefined
    s.start(`Running: ${pm.runner} @capgo/cli@latest bundle upload`)
    const isMonorepo = projectIsMonorepo(cwd())
    if (globalPathToPackageJson && isMonorepo) {
      pLog.warn(`You are most likely using a monorepo, please provide the path to your package.json file AND node_modules path folder when uploading your bundle`)
      pLog.warn(`Example: ${pm.runner} @capgo/cli@latest bundle upload --package-json ./packages/my-app/package.json --node-modules ./packages/my-app/node_modules`)
      nodeModulesPath = join(findRoot(cwd()), 'node_modules')
      pLog.warn(`Guessed node modules path at: ${nodeModulesPath}`)
      if (!existsSync(nodeModulesPath)) {
        pLog.error(`Node modules path does not exist, upload skipped`)
        pOutro(`Bye 👋`)
        exit(1)
      }
    }
    const uploadRes = await uploadBundle(appId, {
      channel: defaultChannel,
      apikey,
      packageJson: isMonorepo ? globalPathToPackageJson : undefined,
      nodeModules: isMonorepo ? nodeModulesPath : undefined,
    }, false)
    if (!uploadRes) {
      s.stop('Error')
      pLog.warn(`Upload failed ❌`)
      pOutro(`Bye 👋`)
      exit()
    }
    else {
      s.stop(`Upload Done ✅`)
    }
  }
  else {
    pLog.info(`Upload yourself with command: ${pm.runner} @capgo/cli@latest bundle upload`)
  }
  await markStep(orgId, apikey, 8)
}

async function step9(orgId: string, apikey: string) {
  const pm = getPMAndCommand()
  const doRun = await pConfirm({ message: `Run in device now ?` })
  await cancelCommand(doRun, orgId, apikey)
  if (doRun) {
    const plaformType = await pSelect({
      message: 'Pick a platform to run your app',
      options: [
        { value: 'ios', label: 'IOS' },
        { value: 'android', label: 'Android' },
      ],
    })
    if (pIsCancel(plaformType)) {
      pOutro(`Bye 👋`)
      exit()
    }

    const platform = plaformType as 'ios' | 'android'
    const s = pSpinner()
    s.start(`Running: ${pm.runner} cap run ${platform}`)
    await spawnSync(pm.runner, ['cap', 'run', platform], { stdio: 'inherit' })
    s.stop(`Started Done ✅`)
  }
  else {
    pLog.info(`If you change your mind, run it for yourself with: ${pm.runner} cap run <ios|android>`)
  }
  await markStep(orgId, apikey, 9)
}

async function step10(orgId: string, apikey: string, appId: string, hostWeb: string) {
  const doRun = await pConfirm({ message: `Automatic check if update working in device ?` })
  await cancelCommand(doRun, orgId, apikey)
  if (doRun) {
    pLog.info(`Wait logs sent to Capgo from ${appId} device, Please open your app 💪`)
    await waitLog('onboarding-v2', apikey, appId, apikey, orgId)
  }
  else {
    const appIdUrl = convertAppName(appId)
    pLog.info(`Check logs in ${hostWeb}/app/p/${appIdUrl}/logs to see if update works.`)
  }
  await markStep(orgId, apikey, 10)
}

export async function initApp(apikeyCommand: string, appId: string, options: SuperOptions) {
  const pm = getPMAndCommand()
  pIntro(`Capgo onboarding 🛫`)
  await checkAlerts()

  const extConfig = (!options.supaAnon || !options.supaHost)
    ? await getConfig()
    : await updateConfig({
      statsUrl: `${options.supaHost}/functions/v1/stats`,
      channelUrl: `${options.supaHost}/functions/v1/channel_self`,
      updateUrl: `${options.supaHost}/functions/v1/updates`,
      localApiFiles: `${options.supaHost}/functions/v1`,
      localS3: true,
      localSupa: options.supaHost,
      localSupaAnon: options.supaAnon,
    })
  const localConfig = await getLocalConfig()
  appId = getAppId(appId, extConfig?.config)
  options.apikey = apikeyCommand || findSavedKey()

  if (appId === undefined) {
    // ask for the appId
    appId = await pText({
      message: 'Enter your appId:',
    }) as string
    if (pIsCancel(appId)) {
      pCancel('Operation cancelled.')
      exit(1)
    }
  }

  const log = pSpinner()
  if (!doLoginExists() || apikeyCommand) {
    log.start(`Running: ${pm.runner} @capgo/cli@latest login ***`)
    await login(options.apikey, options, false)
    log.stop('Login Done ✅')
  }

  const supabase = await createSupabaseClient(options.apikey)
  await verifyUser(supabase, options.apikey, ['upload', 'all', 'read', 'write'])

  const organization = await getOrganization(supabase, ['admin', 'super_admin'])
  const orgId = organization.gid

  const stepToSkip = await readStepsDone(orgId, options.apikey) ?? 0

  try {
    if (stepToSkip < 1)
      await markStep(orgId, options.apikey, 1)

    if (stepToSkip < 2) {
      await step2(organization, options.apikey, appId, options)
      markStepDone(2)
    }

    if (stepToSkip < 3) {
      await step3(orgId, options.apikey, appId)
      markStepDone(3)
    }

    if (stepToSkip < 4) {
      await step4(orgId, options.apikey, appId)
      markStepDone(4)
    }

    if (stepToSkip < 5) {
      await step5(orgId, options.apikey, appId)
      markStepDone(5)
    }

    if (stepToSkip < 6) {
      await step6(orgId, options.apikey, appId) // TODO: Do not push more people to use encryption as it is not yet secure as it should be
      markStepDone(6)
    }

    if (stepToSkip < 7) {
      await step7(orgId, options.apikey, appId)
      markStepDone(7)
    }

    if (stepToSkip < 8) {
      await step8(orgId, options.apikey, appId)
      markStepDone(8)
    }

    if (stepToSkip < 9) {
      await step9(orgId, options.apikey)
      markStepDone(9)
    }

    await step10(orgId, options.apikey, appId, localConfig.hostWeb)
    await markStep(orgId, options.apikey, 0)
    cleanupStepsDone()
  }
  catch (e) {
    console.error(e)
    pLog.error(`Error during onboarding, please try again later`)
    exit(1)
  }

  pLog.info(`Welcome onboard ✈️!`)
  pLog.info(`Your Capgo update system is setup`)
  pLog.info(`Next time use \`${pm.runner} @capgo/cli@latest bundle upload\` to only upload your bundle`)
  pLog.info(`If you have any issue try to use the debug command \`${pm.runner} @capgo/cli@latest app debug\``)
  pOutro(`Bye 👋`)
  exit()
}
