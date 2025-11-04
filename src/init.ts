import type { ExecSyncOptions } from 'node:child_process'
import type { Options } from './api/app'
import type { Organization } from './utils'
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd, exit } from 'node:process'
import { cancel as pCancel, confirm as pConfirm, intro as pIntro, isCancel as pIsCancel, log as pLog, outro as pOutro, select as pSelect, spinner as pSpinner, text as pText } from '@clack/prompts'
import semverInc from 'semver/functions/inc'
// We only use semver from std for Capgo semver, others connected to package.json need npm one as it's not following the semver spec
import semverLt from 'semver/functions/lt'
import tmp from 'tmp'
import { checkAlerts } from './api/update'
import { addAppInternal } from './app/add'
import { markSnag, waitLog } from './app/debug'
import { uploadBundle } from './bundle/upload'
import { addChannel } from './channel/add'
import { createKeyV2 } from './keyV2'
import { doLoginExists, login } from './login'
import { createSupabaseClient, findBuildCommandForProjectType, findMainFile, findMainFileForProjectType, findProjectType, findRoot, findSavedKey, getAllPackagesDependencies, getAppId, getBundleVersion, getConfig, getLocalConfig, getOrganization, getPackageScripts, getPMAndCommand, PACKNAME, projectIsMonorepo, promptAndSyncCapacitor, updateConfigbyKey, updateConfigUpdater, verifyUser } from './utils'

interface SuperOptions extends Options {
  local: boolean
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
  tmpObject ??= readdirSync(tmp.tmpdir)
    .map((name) => { return { name, full: `${tmp.tmpdir}/${name}` } })
    .find(obj => obj.name.startsWith('capgocli'))
    ?.full
    ?? tmp.fileSync({ prefix: 'capgocli' }).name
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

async function markStep(orgId: string, apikey: string, step: string, appId: string) {
  return markSnag('onboarding-v2', orgId, apikey, `onboarding-step-${step}`, appId)
}

async function addAppStep(organization: Organization, apikey: string, appId: string, options: SuperOptions) {
  const pm = getPMAndCommand()
  const doAdd = await pConfirm({ message: `Add ${appId} in Capgo?` })
  await cancelCommand(doAdd, organization.gid, apikey)
  if (doAdd) {
    const s = pSpinner()
    s.start(`Running: ${pm.runner} @capgo/cli@latest app add ${appId}`)
    const addRes = await addAppInternal(appId, options, organization, true)
    if (!addRes)
      s.stop(`App already add ✅`)
    else
      s.stop(`App add Done ✅`)
  }
  else {
    pLog.info(`If you change your mind, run it for yourself with: "${pm.runner} @capgo/cli@latest app add ${appId}"`)
  }
  await markStep(organization.gid, apikey, 'add-app', appId)
}

async function addChannelStep(orgId: string, apikey: string, appId: string) {
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
    }, true)
    if (!addChannelRes)
      s.stop(`Channel already added ✅`)
    else
      s.stop(`Channel add Done ✅`)
  }
  else {
    pLog.info(`If you change your mind, run it for yourself with: "${pm.runner} @capgo/cli@latest channel add ${defaultChannel} ${appId} --default"`)
  }
  await markStep(orgId, apikey, 'add-channel', appId)
}

async function getAssistedDependencies(stepsDone: number) {
  // here we will assume that getAlllPackagesDependencies uses 'findRoot(cwd())' for the first argument
  const root = join(findRoot(cwd()), PACKNAME)
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
        let selectedPath = PACKNAME as string | symbol
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
          if (!statSync(join(path, selectedPath)).isDirectory() && selectedPath !== PACKNAME) {
            pLog.error(`Selected a file that is not a package.json file`)
            continue
          }
          path = join(path, selectedPath)
          if (selectedPath === PACKNAME) {
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
const urlMigrateV7 = 'https://capacitorjs.com/docs/updating/7-0'
async function addUpdaterStep(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  let pkgVersion = '1.0.0'
  let delta = false
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

    const coreVersion = dependencies.get('@capacitor/core')
    if (!coreVersion) {
      s.stop('Error')
      pLog.warn(`Cannot find @capacitor/core in package.json, please run \`capgo init\` in a capacitor project`)
      pOutro(`Bye 👋`)
      exit()
    }

    if (coreVersion === 'latest') {
      s.stop(`@capacitor/core version is ${coreVersion}, make sure to use a proper version, using Latest as value is not recommended and will lead to unexpected behavior`)
      pOutro(`Bye 👋`)
      exit()
    }
    else if (semverLt(coreVersion, '6.0.0')) {
      s.stop('Error')
      pLog.warn(`@capacitor/core version is ${coreVersion}, Capgo only support 2 last Capacitor versions, please update to Capacitor v6 minimum: ${urlMigrateV6}`)
      pOutro(`Bye 👋`)
      exit()
    }
    else if (semverLt(coreVersion, '7.0.0')) {
      s.stop(`@capacitor/core version is ${coreVersion}, update to Capacitor v7 minimum: ${urlMigrateV7} to get the best features of Capgo`)
      versionToInstall = '^6.0.0'
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
      await execSync(`${pm.installCommand} --force @capgo/capacitor-updater@${versionToInstall}`, { ...execOption, cwd: path.replace('/package.json', '') } as ExecSyncOptions)
      s.stop(`Install Done ✅`)
      pkgVersion = getBundleVersion(undefined, path) || '1.0.0'
      let doDirectInstall: boolean | symbol = false
      if (versionToInstall === 'latest') {
        doDirectInstall = await pConfirm({ message: `Do you want to set instant updates in ${appId}? Read more about it here: https://capgo.app/docs/live-updates/update-behavior/#applying-updates-immediately` })
        await cancelCommand(doDirectInstall, orgId, apikey)
      }
      s.start(`Updating config file`)
      delta = !!doDirectInstall
      const directInstall = doDirectInstall
        ? {
            directUpdate: 'always',
            autoSplashscreen: true,
          }
        : {}
      if (doDirectInstall) {
        await updateConfigbyKey('SplashScreen', { launchAutoHide: false })
      }
      await updateConfigUpdater({ version: pkgVersion, appId, autoUpdate: true, ...directInstall })
      s.stop(`Config file updated ✅`)
    }
  }
  else {
    pLog.info(`If you change your mind, run it for yourself with: "${pm.installCommand} @capgo/capacitor-updater@latest"`)
  }
  await markStep(orgId, apikey, 'add-updater', appId)
  return { pkgVersion, delta }
}

async function addCodeStep(orgId: string, apikey: string, appId: string) {
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
        pLog.warn(`Cannot find import line in main file, use manual installation: https://capgo.app/docs/getting-started/add-an-app/`)
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

    await markStep(orgId, apikey, 'add-code', appId)
  }
  else {
    pLog.info(`Add to your main file the following code:\n\n${importInject};\n\n${codeInject};\n`)
  }
}

async function addEncryptionStep(orgId: string, apikey: string, appId: string) {
  const dependencies = await getAllPackagesDependencies()
  const coreVersion = dependencies.get('@capacitor/core')
  if (!coreVersion) {
    pLog.warn(`Cannot find @capacitor/core in package.json. It is likely that you are using a monorepo. Please NOTE that encryption is not supported in Capacitor V5.`)
  }

  const pm = getPMAndCommand()
  const doEncrypt = await pConfirm({ message: `Automatic configure end-to-end encryption in ${appId} updates?` })
  await cancelCommand(doEncrypt, orgId, apikey)
  if (doEncrypt) {
    if (coreVersion === 'latest') {
      pLog.error(`@capacitor/core version is ${coreVersion}, make sure to use a proper version, using Latest as value is not recommended and will lead to unexpected behavior`)
      return
    }
    if (coreVersion && semverLt(coreVersion, '6.0.0')) {
      pLog.warn(`Encryption is not supported in Capacitor V5.`)
      return
    }

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

    // Ask user if they want to sync with Capacitor after key creation
    // Pass true for isInit flag to track cancellation during onboarding flow
    // orgId and apikey are needed to mark snag if user cancels
    try {
      await promptAndSyncCapacitor(true, orgId, apikey)
      markSnag('onboarding-v2', orgId, apikey, 'Use encryption v2', appId)
    }
    catch (error) {
      // Only handle cancellation gracefully - re-throw any other errors
      if (error instanceof Error && error.message === 'Capacitor sync cancelled') {
        // User cancelled the sync - cancellation is already tracked in promptAndSyncCapacitor
        // Just continue without marking the successful completion
      }
      else {
        // Re-throw any other errors (e.g., network errors, permission errors, etc.)
        throw error
      }
    }
  }
  await markStep(orgId, apikey, 'add-encryption', appId)
}

async function buildProjectStep(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doBuild = await pConfirm({ message: `Automatic build ${appId} with "${pm.pm} run build" ?` })
  await cancelCommand(doBuild, orgId, apikey)
  if (doBuild) {
    const s = pSpinner()
    s.start(`Checking project type`)
    const projectType = await findProjectType()
    const buildCommand = await findBuildCommandForProjectType(projectType)
    s.message(`Running: ${pm.pm} run ${buildCommand} && ${pm.runner} cap sync`)
    const packScripts = getPackageScripts()
    // check in script build exist
    if (!packScripts[buildCommand]) {
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
  await markStep(orgId, apikey, 'build-project', appId)
}

async function runDeviceStep(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  const doRun = await pConfirm({ message: `Run ${appId} in device now to test the initial version?` })
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
    s.stop(`App started ✅`)
    pLog.info(`📱 Your app should now be running on your ${platform} device with Capgo integrated`)
    pLog.info(`🔄 This is your baseline version - we'll create an update next`)
  }
  else {
    pLog.info(`If you change your mind, run it for yourself with: ${pm.runner} cap run <ios|android>`)
  }
  await markStep(orgId, apikey, 'run-device', appId)
}

async function addCodeChangeStep(orgId: string, apikey: string, appId: string, pkgVersion: string) {
  pLog.info(`🎯 Now let's test Capgo by making a visible change and deploying an update!`)

  const modificationType = await pSelect({
    message: 'How would you like to test the update?',
    options: [
      { value: 'auto', label: 'Auto: Let Capgo CLI make a visible change for you' },
      { value: 'manual', label: 'Manual: I\'ll make changes myself' },
    ],
  })
  if (pIsCancel(modificationType)) {
    await markSnag('onboarding-v2', orgId, apikey, 'canceled', '🤷')
    exit()
  }

  if (modificationType === 'auto') {
    const s = pSpinner()
    s.start('Making automatic changes to test Capgo updates')

    let changed = false

    // Try to find and modify ONE file only, prioritizing HTML files
    const possibleFiles = [
      'src/index.html',
      'public/index.html',
      'index.html',
      'src/App.vue',
      'src/app/app.component.html',
      'src/app/home/home.page.html',
      'src/main.css',
      'src/style.css',
      'public/style.css',
    ]

    for (const filePath of possibleFiles) {
      if (existsSync(filePath) && !changed) {
        try {
          const content = readFileSync(filePath, 'utf8')
          let newContent = content

          if (filePath.endsWith('.html')) {
            // Add a visible banner to HTML files
            if (content.includes('<body>') && !content.includes('capgo-test-banner')) {
              newContent = content.replace(
                '<body>',
                `<body>
  <div id="capgo-test-banner" style="background: linear-gradient(90deg, #4CAF50, #2196F3); color: white; padding: 15px; text-align: center; font-weight: bold; position: fixed; top: env(safe-area-inset-top, 0); left: env(safe-area-inset-left, 0); right: env(safe-area-inset-right, 0); z-index: 9999; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding-top: calc(15px + env(safe-area-inset-top, 0));">
    🚀 Capgo Update Test - This banner shows the update worked!
  </div>
  <style>
    body { padding-top: calc(60px + env(safe-area-inset-top, 0)) !important; }
  </style>`,
              )
            }
          }
          else if (filePath.endsWith('.vue')) {
            // Add a test banner to Vue components
            if (content.includes('<template>') && !content.includes('capgo-test-vue')) {
              newContent = content.replace(
                '<template>',
                `<template>
  <div class="capgo-test-vue" style="background: linear-gradient(90deg, #4CAF50, #2196F3); color: white; padding: 15px; text-align: center; font-weight: bold; margin-bottom: 20px; padding-top: calc(15px + env(safe-area-inset-top, 0)); padding-left: calc(15px + env(safe-area-inset-left, 0)); padding-right: calc(15px + env(safe-area-inset-right, 0));">
    🚀 Capgo Update Test - Vue component updated!
  </div>`,
              )
            }
          }
          else if (filePath.endsWith('.css')) {
            // Add body background change as fallback
            if (!content.includes('capgo-test-background')) {
              newContent = `/* Capgo test modification - background change */
body {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  /* capgo-test-background */
}

${content}`
            }
          }

          if (newContent !== content) {
            writeFileSync(filePath, newContent, 'utf8')
            s.stop(`✅ Made test changes to ${filePath}`)
            pLog.info(`📝 Added visible test modification to verify the update works`)
            changed = true
            break
          }
        }
        catch {
          // Continue to next file
        }
      }
    }

    if (!changed) {
      s.stop('⚠️  Could not automatically modify files')
      pLog.warn('Please make a visible change manually (like editing a text or color)')
      const continueManual = await pConfirm({ message: 'Continue after making your changes?' })
      await cancelCommand(continueManual, orgId, apikey)
    }
  }
  else {
    pLog.info(`✋ Please make a visible change to your app now (example: change a text, color, or add an element)`)
    pLog.info(`💡 This change will help you see that Capgo updates work correctly`)
    const changesReady = await pConfirm({ message: 'Have you made your changes and ready to continue?' })
    await cancelCommand(changesReady, orgId, apikey)
  }

  // Version bump
  const nextVersion = semverInc(pkgVersion, 'patch') || '1.0.1'
  const versionChoice = await pSelect({
    message: 'How do you want to handle the version for this update?',
    options: [
      { value: 'auto', label: `Auto: Bump patch version (${pkgVersion} → ${nextVersion})` },
      { value: 'manual', label: 'Manual: I\'ll provide the version number' },
    ],
  })
  if (pIsCancel(versionChoice)) {
    await markSnag('onboarding-v2', orgId, apikey, 'canceled', '🤷')
    exit()
  }

  let newVersion = pkgVersion
  if (versionChoice === 'auto') {
    // Auto bump patch version using semver
    const incrementedVersion = semverInc(pkgVersion, 'patch')
    if (incrementedVersion) {
      newVersion = incrementedVersion
      pLog.info(`🔢 Auto-bumped version from ${pkgVersion} to ${newVersion}`)
    }
    else {
      newVersion = '1.0.1' // fallback
      pLog.warn(`Could not parse version ${pkgVersion}, using fallback ${newVersion}`)
    }
  }
  else {
    const userVersion = await pText({
      message: `Current version is ${pkgVersion}. Enter new version:`,
      validate: (value) => {
        if (!value.match(/^\d+\.\d+\.\d+/))
          return 'Please enter a valid version (x.y.z)'
      },
    })
    if (pIsCancel(userVersion)) {
      await markSnag('onboarding-v2', orgId, apikey, 'canceled', '🤷')
      exit()
    }
    newVersion = userVersion as string
  }
  // Build after modifications
  const pm = getPMAndCommand()
  const doBuild = await pConfirm({ message: `Build ${appId} with changes before uploading? If you need to build yourself please do it now in other terminal, and then select no` })
  await cancelCommand(doBuild, orgId, apikey)
  if (doBuild) {
    const s = pSpinner()
    s.start(`Checking project type`)
    const projectType = await findProjectType()
    const buildCommand = await findBuildCommandForProjectType(projectType)
    s.message(`Running: ${pm.pm} run ${buildCommand} && ${pm.runner} cap sync`)
    const packScripts = getPackageScripts()
    // check in script build exist
    if (!packScripts[buildCommand]) {
      s.stop('Error')
      pLog.warn(`Cannot find ${buildCommand} script in package.json, please add it and run \`capgo init\` again`)
      pOutro(`Bye 👋`)
      exit()
    }
    execSync(`${pm.pm} run ${buildCommand} && ${pm.runner} cap sync`, execOption as ExecSyncOptions)
    s.stop(`✅ Build with changes completed`)
    pLog.info(`📦 Your modifications have been built and synced`)
  }
  else {
    pLog.info(`Build yourself with command: ${pm.pm} run build && ${pm.runner} cap sync`)
  }

  await markStep(orgId, apikey, 'add-code-change', appId)
  return newVersion
}

async function uploadStep(orgId: string, apikey: string, appId: string, newVersion: string, delta: boolean) {
  const pm = getPMAndCommand()
  const doBundle = await pConfirm({ message: `Upload the updated ${appId} bundle (v${newVersion}) to Capgo?` })
  await cancelCommand(doBundle, orgId, apikey)
  if (doBundle) {
    const s = pSpinner()
    let nodeModulesPath: string | undefined
    s.start(`Running: ${pm.runner} @capgo/cli@latest bundle upload ${delta ? '--delta-only' : ''}`)
    const isMonorepo = projectIsMonorepo(cwd())
    if (globalPathToPackageJson && isMonorepo) {
      pLog.warn(`You are most likely using a monorepo, please provide the path to your package.json file AND node_modules path folder when uploading your bundle`)
      pLog.warn(`Example: ${pm.runner} @capgo/cli@latest bundle upload --package-json ./packages/my-app/package.json --node-modules ./packages/my-app/node_modules ${delta ? '--delta-only' : ''}`)
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
      deltaOnly: delta,
      bundle: newVersion,
    }, false)
    if (!uploadRes?.success) {
      s.stop('Error')
      pLog.warn(`Upload failed ❌`)
      pOutro(`Bye 👋`)
      exit()
    }
    else {
      s.stop(`✅ Update v${newVersion} uploaded successfully!`)
      pLog.info(`🎉 Your updated bundle is now available on Capgo`)
    }
  }
  else {
    pLog.info(`Upload yourself with command: ${pm.runner} @capgo/cli@latest bundle upload`)
  }
  await markStep(orgId, apikey, 'upload', appId)
}

async function testCapgoUpdateStep(orgId: string, apikey: string, appId: string, hostWeb: string, delta: boolean) {
  pLog.info(`🧪 Time to test the Capgo update system!`)
  pLog.info(`📱 Go to your device where the app is running`)

  if (delta) {
    pLog.info(`🔄 IMPORTANT: Background your app (swipe up/press home button) and then reopen it`)
    pLog.info(`⏱️  The update should be downloaded and applied automatically`)
  }
  else {
    pLog.info(`📱 With standard updates, you will need to:`)
    pLog.info(`   1. Background the app (swipe up/press home button) to start download`)
    pLog.info(`   2. Wait a few seconds for download to complete`)
    pLog.info(`   3. Background and foreground again to see the update`)
  }

  pLog.info(`👀 You should see your changes appear in the app!`)

  const doWaitLogs = await pConfirm({ message: `Monitor Capgo logs to verify the update worked?` })
  await cancelCommand(doWaitLogs, orgId, apikey)

  if (doWaitLogs) {
    pLog.info(`📊 Watching logs from ${appId}...`)
    pLog.info(`🔄 Please background and reopen your app now to trigger the update`)
    await waitLog('onboarding-v2', apikey, appId, apikey, orgId)
  }
  else {
    pLog.info(`📊 Check logs manually at ${hostWeb}/app/p/${appId}/logs to verify the update`)
  }
  await markStep(orgId, apikey, 'test-update', appId)
}

export async function initApp(apikeyCommand: string, appId: string, options: SuperOptions) {
  const pm = getPMAndCommand()
  pIntro(`Capgo onboarding 🛫`)
  await checkAlerts()

  const extConfig = (!options.supaAnon || !options.supaHost)
    ? await getConfig()
    : await updateConfigUpdater({
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

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
  await verifyUser(supabase, options.apikey, ['upload', 'all', 'read', 'write'])

  const organization = await getOrganization(supabase, ['admin', 'super_admin'])
  const orgId = organization.gid

  const stepToSkip = await readStepsDone(orgId, options.apikey) ?? 0
  let pkgVersion = getBundleVersion(undefined, globalPathToPackageJson) || '1.0.0'
  let delta = false
  let currentVersion = pkgVersion

  try {
    if (stepToSkip < 1)
      await markStep(orgId, options.apikey, 'add-app', appId)

    if (stepToSkip < 2) {
      await addAppStep(organization, options.apikey, appId, options)
      markStepDone(2)
    }

    if (stepToSkip < 3) {
      await addChannelStep(orgId, options.apikey, appId)
      markStepDone(3)
    }

    if (stepToSkip < 4) {
      const res = await addUpdaterStep(orgId, options.apikey, appId)
      pkgVersion = res.pkgVersion
      currentVersion = pkgVersion
      delta = res.delta
      markStepDone(4)
    }

    if (stepToSkip < 5) {
      await addCodeStep(orgId, options.apikey, appId)
      markStepDone(5)
    }

    if (stepToSkip < 6) {
      await addEncryptionStep(orgId, options.apikey, appId)
      markStepDone(6)
    }

    if (stepToSkip < 7) {
      await buildProjectStep(orgId, options.apikey, appId)
      markStepDone(7)
    }

    if (stepToSkip < 8) {
      await runDeviceStep(orgId, options.apikey, appId)
      markStepDone(8)
    }

    if (stepToSkip < 9) {
      currentVersion = await addCodeChangeStep(orgId, options.apikey, appId, pkgVersion)
      markStepDone(9)
    }

    if (stepToSkip < 10) {
      await uploadStep(orgId, options.apikey, appId, currentVersion, delta)
      markStepDone(10)
    }

    if (stepToSkip < 11) {
      await testCapgoUpdateStep(orgId, options.apikey, appId, localConfig.hostWeb, delta)
      markStepDone(11)
    }

    await markStep(orgId, options.apikey, 'done', appId)
    cleanupStepsDone()
  }
  catch (e) {
    console.error(e)
    pLog.error(`Error during onboarding.\n if the error persists please contact support@capgo.app\n Or use manual installation: https://capgo.app/docs/getting-started/add-an-app/`)
    exit(1)
  }

  pLog.info(`Welcome onboard ✈️!`)
  pLog.info(`Your Capgo update system is setup`)
  pLog.info(`Next time use \`${pm.runner} @capgo/cli@latest bundle upload\` to only upload your bundle`)
  pLog.info(`If you have any issue try to use the debug command \`${pm.runner} @capgo/cli@latest app debug\``)
  pOutro(`Bye 👋`)
  exit()
}
