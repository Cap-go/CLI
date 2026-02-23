import type { ExecSyncOptions } from 'node:child_process'
import type { Options } from './api/app'
import { checkAppIdsExist } from './api/app'
import type { Organization } from './utils'
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path, { dirname, join } from 'node:path'
import { cwd, env, exit, platform } from 'node:process'
import { cancel as pCancel, confirm as pConfirm, intro as pIntro, isCancel as pIsCancel, log as pLog, outro as pOutro, select as pSelect, spinner as pSpinner, text as pText } from '@clack/prompts'
import { format, increment, lessThan, parse } from '@std/semver'
import tmp from 'tmp'
import { checkAlerts } from './api/update'
import { addAppInternal } from './app/add'
import { markSnag, waitLog } from './app/debug'
import { explainCommonUpdateError, getLikelyMajorBlockWarning, pollUpdateAvailability, prepareUpdateProbe } from './app/updateProbe'
import { uploadBundleInternal } from './bundle/upload'
import { addChannelInternal } from './channel/add'
import { createKeyInternal } from './key'
import { doLoginExists, loginInternal } from './login'
import { createSupabaseClient, findBuildCommandForProjectType, findMainFile, findMainFileForProjectType, findProjectType, findRoot, findSavedKey, getAllPackagesDependencies, getAppId, getBundleVersion, getConfig, getInstalledVersion, getLocalConfig, getOrganization, getPackageScripts, getPMAndCommand, PACKNAME, projectIsMonorepo, promptAndSyncCapacitor, updateConfigbyKey, updateConfigUpdater, validateIosUpdaterSync, verifyUser } from './utils'

interface SuperOptions extends Options {
  local: boolean
}
const importInject = 'import { CapacitorUpdater } from \'@capgo/capacitor-updater\''
const codeInject = 'CapacitorUpdater.notifyAppReady()'
// create regex to find line who start by 'import ' and end by ' from '
const regexImport = /import.*from.*/g
const defaultChannel = 'production'
const execOption = { stdio: 'pipe' }
const capacitorConfigFiles = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json']

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
    pLog.error(`Cannot read which steps have been completed, error:\n${err}`)
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
    pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
    exit()
  }
}

/**
 * Find the nearest Capacitor config file by walking up the directory tree.
 */
function findNearestCapacitorConfig(startDir: string) {
  let currentDir = startDir
  const rootDir = path.parse(currentDir).root

  while (true) {
    for (const file of capacitorConfigFiles) {
      const candidate = join(currentDir, file)
      if (existsSync(candidate))
        return { dir: currentDir, file: candidate }
    }

    if (currentDir === rootDir)
      break

    const parent = dirname(currentDir)
    if (parent === currentDir)
      break
    currentDir = parent
  }

  return undefined
}

/**
 * Warn and optionally stop if onboarding is started outside the Capacitor project root.
 */
async function warnIfNotInCapacitorRoot() {
  const currentDir = cwd()
  const configHere = capacitorConfigFiles.some(file => existsSync(join(currentDir, file)))

  if (configHere)
    return

  const nearest = findNearestCapacitorConfig(currentDir)

  pLog.warn('Capacitor config not found in the current folder.')
  if (nearest) {
    pLog.info(`Found a capacitor config at: ${nearest.file}`)
    pLog.info(`You are currently in: ${currentDir}`)
  }
  else {
    pLog.info('No capacitor config was found in this folder or any parent directories.')
  }

  const currentFolder = path.basename(currentDir)
  if (currentFolder === 'ios' || currentFolder === 'android') {
    pLog.info('It looks like you are inside a platform folder (ios/android).')
    pLog.info('Try running the onboarding from the project root (the folder with capacitor.config.*).')
  }

  const continueAnyway = await pConfirm({
    message: 'Are you sure you want to continue? If you do, the auto-configuration will probably not work from here.',
    initialValue: false,
  })

  if (pIsCancel(continueAnyway) || !continueAnyway) {
    pCancel('Operation cancelled.')
    exit(1)
  }
}

async function markStep(orgId: string, apikey: string, step: string, appId: string) {
  return markSnag('onboarding-v2', orgId, apikey, `onboarding-step-${step}`, appId)
}

/**
 * Save the app ID to the CapacitorUpdater plugin config.
 */
async function saveAppIdToCapacitorConfig(appId: string) {
  try {
    await updateConfigUpdater({ appId })
    pLog.info(`💾 Saved new app ID "${appId}" to CapacitorUpdater config`)
  }
  catch (err) {
    pLog.warn(`⚠️  Could not save app ID to capacitor config: ${err}`)
    pLog.info(`   You may need to manually update your capacitor.config file with the new app ID: ${appId}`)
  }
}

function stopForBrokenIosSync(platformRunner: string, details: string[]): never {
  pLog.error('Capgo iOS dependency sync verification failed.')
  for (const detail of details) {
    pLog.error(detail)
  }
  pLog.error('Stop here to avoid testing on a broken native iOS project.')
  pLog.warn('Best fix: reset the iOS folder, then run sync again.')
  pLog.info(`1. ${platformRunner} cap rm ios`)
  pLog.info(`2. ${platformRunner} cap add ios`)
  pLog.info(`3. ${platformRunner} cap sync ios`)
  pOutro('After reset, run the same `capgo init ...` command to resume onboarding from where you left off (no need to redo previous steps).')
  exit(1)
}

async function checkPrerequisitesStep(orgId: string, apikey: string) {
  pLog.info(`📋 Checking development environment prerequisites`)
  pLog.info(`   For mobile development, you need at least one platform setup`)

  const hasXcode = platform === 'darwin' && existsSync('/Applications/Xcode.app')

  // Check for Android SDK in common locations
  const homeDir = env.HOME || env.USERPROFILE || '~'
  const androidPaths = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    join(homeDir, 'Library', 'Android', 'sdk'), // macOS
    join(homeDir, 'Android', 'Sdk'), // Windows/Linux
    join(homeDir, 'AppData', 'Local', 'Android', 'Sdk'), // Windows alternative
  ].filter(Boolean)

  const hasAndroidStudio = androidPaths.some(path => path && existsSync(path))

  if (hasXcode) {
    pLog.success(`✅ Xcode detected - iOS development ready`)
  }
  else if (platform === 'darwin') {
    pLog.warn(`⚠️  Xcode not found`)
  }

  if (hasAndroidStudio) {
    pLog.success(`✅ Android SDK detected - Android development ready`)
  }
  else {
    pLog.warn(`⚠️  Android SDK not found`)
  }

  if (!hasXcode && !hasAndroidStudio) {
    pLog.error(`❌ No development environment detected`)
    pLog.info(``)
    pLog.info(`📱 To develop mobile apps with Capacitor, you need:`)
    pLog.info(`   • For iOS: Xcode (macOS only) - https://developer.apple.com/xcode/`)
    pLog.info(`   • For Android: Android Studio - https://developer.android.com/studio`)
    pLog.info(``)

    const continueAnyway = await pConfirm({
      message: `Continue onboarding without a development environment? (You won't be able to build or test)`,
      initialValue: false,
    })
    await cancelCommand(continueAnyway, orgId, apikey)

    if (!continueAnyway) {
      pLog.info(`📝 Please install a development environment and run the onboarding again`)
      pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
      exit()
    }

    pLog.warn(`⚠️  Continuing without development environment - you'll need to set it up later`)
  }
  else if (!hasXcode && platform === 'darwin') {
    const wantsIos = await pConfirm({
      message: `Xcode is not installed. Do you plan to develop for iOS?`,
      initialValue: false,
    })
    await cancelCommand(wantsIos, orgId, apikey)

    if (wantsIos) {
      pLog.info(`📥 Please install Xcode from: https://developer.apple.com/xcode/`)
      pLog.info(`💡 After installing Xcode, you can continue the onboarding`)

      const installedNow = await pConfirm({
        message: `Have you installed Xcode? (Choose No to continue with Android only)`,
        initialValue: false,
      })
      await cancelCommand(installedNow, orgId, apikey)

      if (!installedNow) {
        pLog.info(`📱 Continuing with Android development only`)
      }
    }
  }
  else if (!hasAndroidStudio) {
    const wantsAndroid = await pConfirm({
      message: `Android SDK is not installed. Do you plan to develop for Android?`,
      initialValue: false,
    })
    await cancelCommand(wantsAndroid, orgId, apikey)

    if (wantsAndroid) {
      pLog.info(`📥 Please install Android Studio from: https://developer.android.com/studio`)
      pLog.info(`💡 After installing Android Studio, set up the Android SDK`)

      const installedNow = await pConfirm({
        message: `Have you installed Android Studio? (Choose No to continue with iOS only)`,
        initialValue: false,
      })
      await cancelCommand(installedNow, orgId, apikey)

      if (!installedNow) {
        pLog.info(`📱 Continuing with iOS development only`)
      }
    }
  }

  await markStep(orgId, apikey, 'check-prerequisites', 'checked')
}

async function addAppStep(organization: Organization, apikey: string, appId: string, options: SuperOptions): Promise<string> {
  const pm = getPMAndCommand()
  let currentAppId = appId
  let retryCount = 0
  const maxRetries = 5

  while (retryCount < maxRetries) {
    const doAdd = await pConfirm({ message: `Add ${currentAppId} in Capgo?` })
    await cancelCommand(doAdd, organization.gid, apikey)

    if (!doAdd) {
      pLog.info(`If you change your mind, run it for yourself with: "${pm.runner} @capgo/cli@latest app add ${currentAppId}"`)
      await markStep(organization.gid, apikey, 'add-app', currentAppId)
      return currentAppId
    }

    try {
      const s = pSpinner()
      s.start(`Running: ${pm.runner} @capgo/cli@latest app add ${currentAppId}`)
      const addRes = await addAppInternal(currentAppId, options, organization, true)
      if (!addRes)
        s.stop(`App already add ✅`)
      else
        s.stop(`App add Done ✅`)

      pLog.info(`This app is accessible to all members of your organization based on their permissions`)
      await markStep(organization.gid, apikey, 'add-app', currentAppId)
      return currentAppId
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Check if the error is about app already existing
      if (errorMessage.includes('already exist')) {
        retryCount++
        pLog.error(`❌ App ID "${currentAppId}" is already taken`)

        // Generate alternative suggestions with validation
        const rawSuggestions = [
          `${appId}-${Math.random().toString(36).substring(2, 6)}`,
          `${appId}.dev`,
          `${appId}.app`,
          `${appId}-${Date.now().toString().slice(-4)}`,
          `${appId}2`,
          `${appId}3`,
        ]

        // Validate suggestions against database to only show available ones
        const supabase = await createSupabaseClient(options.apikey!, options.supaHost, options.supaAnon)
        const existingResults = await checkAppIdsExist(supabase, rawSuggestions)
        const availableSuggestions = rawSuggestions.filter((_, idx) => !existingResults[idx].exists).slice(0, 4)

        // If no suggestions are available, ask for custom input
        if (availableSuggestions.length === 0) {
          pLog.warn(`No available suggestions found. Please enter a custom app ID.`)
          const customAppId = await pText({
            message: 'Enter your custom app ID (e.g., com.example.myapp):',
            validate: (value) => {
              if (!value)
                return 'App ID is required'
              if (value.includes('--'))
                return 'App ID cannot contain "--"'
              if (!/^[a-z0-9]+(?:\.[\w-]+)+$/i.test(value))
                return 'Invalid format. Use reverse domain notation (e.g., com.example.app)'
            },
          })

          if (pIsCancel(customAppId)) {
            await markSnag('onboarding-v2', organization.gid, apikey, 'canceled', '🤷')
            pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
            exit()
          }

          currentAppId = customAppId as string
        }
        else {
          const suggestions = availableSuggestions

          pLog.info(`💡 Here are some available suggestions:`)
          suggestions.forEach((suggestion, idx) => {
            pLog.info(`   ${idx + 1}. ${suggestion}`)
          })

          const choice = await pSelect({
            message: 'What would you like to do?',
            options: [
              { value: 'suggest1', label: `Use ${suggestions[0]}` },
              ...(suggestions[1] ? [{ value: 'suggest2', label: `Use ${suggestions[1]}` }] : []),
              ...(suggestions[2] ? [{ value: 'suggest3', label: `Use ${suggestions[2]}` }] : []),
              ...(suggestions[3] ? [{ value: 'suggest4', label: `Use ${suggestions[3]}` }] : []),
              { value: 'custom', label: 'Enter a custom app ID' },
              { value: 'cancel', label: 'Cancel onboarding' },
            ].filter(Boolean) as any[],
          })

          if (pIsCancel(choice)) {
            await markSnag('onboarding-v2', organization.gid, apikey, 'canceled', '🤷')
            pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
            exit()
          }

          if (choice === 'cancel') {
            await markSnag('onboarding-v2', organization.gid, apikey, 'canceled-appid-conflict', '🤷')
            pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
            exit()
          }

          if (choice === 'custom') {
            const customAppId = await pText({
              message: 'Enter your custom app ID (e.g., com.example.myapp):',
              validate: (value) => {
                if (!value)
                  return 'App ID is required'
                if (value.includes('--'))
                  return 'App ID cannot contain "--"'
                if (!/^[a-z0-9]+(?:\.[\w-]+)+$/i.test(value))
                  return 'Invalid format. Use reverse domain notation (e.g., com.example.app)'
              },
            })

            if (pIsCancel(customAppId)) {
              await markSnag('onboarding-v2', organization.gid, apikey, 'canceled', '🤷')
              pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
              exit()
            }

            currentAppId = customAppId as string
          }
          else {
            // Use one of the suggestions
            const suggestionIndex = Number.parseInt((choice as string).replace('suggest', '')) - 1
            currentAppId = suggestions[suggestionIndex]
          }
        }

        // Save the new app ID to capacitor config
        await saveAppIdToCapacitorConfig(currentAppId)

        pLog.info(`🔄 Trying with new app ID: ${currentAppId}`)
        continue
      }

      // For other errors, re-throw
      throw error
    }
  }

  // If we've exhausted retries
  pLog.error(`❌ Maximum retry attempts (${maxRetries}) reached`)
  pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
  exit(1)
}

async function addChannelStep(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  pLog.info(`💡 Don't worry! This is just for local testing during onboarding.`)
  pLog.info(`   Creating a "production" channel doesn't mean updates go live to customers immediately.`)
  pLog.info(`   You have full control over when updates are deployed. Select Yes unless you have specific channel requirements.`)
  const doChannel = await pConfirm({ message: `Create default channel ${defaultChannel} for ${appId} in Capgo?` })
  await cancelCommand(doChannel, orgId, apikey)
  if (doChannel) {
    const s = pSpinner()
    // create production channel public
    s.start(`Running: ${pm.runner} @capgo/cli@latest channel add ${defaultChannel} ${appId} --default`)
    const addChannelRes = await addChannelInternal(defaultChannel, appId, {
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
    pLog.info(`Alternatively, you can:`)
    pLog.info(`  • Set the channel in your capacitor.config.ts file`)
    pLog.info(`  • Use the JavaScript setChannel() method to dynamically set the channel`)
    pLog.info(`  • Configure channels later from the Capgo web console`)
  }
  await markStep(orgId, apikey, 'add-channel', appId)
}

async function getAssistedDependencies(stepsDone: number) {
  // here we will assume that getAllPackagesDependencies uses 'findRoot(cwd())' for the first argument
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

const urlMigrateV5 = 'https://capacitorjs.com/docs/updating/5-0'
const urlMigrateV6 = 'https://capacitorjs.com/docs/updating/6-0'
const urlMigrateV7 = 'https://capacitorjs.com/docs/updating/7-0'
const urlMigrateV8 = 'https://capacitorjs.com/docs/updating/8-0'
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
      pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
      exit()
    }

    // Note: dependencies.get() now returns the actual installed version from node_modules
    // (not the declared version from package.json)
    const coreVersion = dependencies.get('@capacitor/core')
    if (!coreVersion) {
      s.stop('Error')
      pLog.warn(`Cannot find @capacitor/core in package.json, please run \`capgo init\` in a capacitor project`)
      pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
      exit()
    }

    if (coreVersion === 'latest') {
      s.stop(`@capacitor/core version is ${coreVersion}, make sure to use a proper version, using Latest as value is not recommended and will lead to unexpected behavior`)
      pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
      exit()
    }
    else if (lessThan(parse(coreVersion), parse('5.0.0'))) {
      s.stop('Error')
      pLog.warn(`@capacitor/core version is ${coreVersion}, Capgo only supports Capacitor v5 and above, please update to Capacitor v5 minimum: ${urlMigrateV5}`)
      pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
      exit()
    }
    else if (lessThan(parse(coreVersion), parse('6.0.0'))) {
      pLog.info(`@capacitor/core version is ${coreVersion}, installing compatible capacitor-updater v5`)
      pLog.warn(`Consider upgrading to Capacitor v6 or higher to support the latest mobile OS features: ${urlMigrateV6}`)
      versionToInstall = '^5.0.0'
    }
    else if (lessThan(parse(coreVersion), parse('7.0.0'))) {
      pLog.info(`@capacitor/core version is ${coreVersion}, installing compatible capacitor-updater v6`)
      pLog.warn(`Consider upgrading to Capacitor v7 or higher to support the latest mobile OS features: ${urlMigrateV7}`)
      versionToInstall = '^6.0.0'
    }
    else if (lessThan(parse(coreVersion), parse('8.0.0'))) {
      pLog.info(`@capacitor/core version is ${coreVersion}, installing compatible capacitor-updater v7`)
      pLog.warn(`Consider upgrading to Capacitor v8 to support the latest mobile OS features: ${urlMigrateV8}`)
      versionToInstall = '^7.0.0'
    }
    else {
      pLog.info(`@capacitor/core version is ${coreVersion}, installing latest capacitor-updater v8+`)
      versionToInstall = '^8.0.0'
    }
    if (pm.pm === 'unknown') {
      s.stop('Error')
      pLog.warn(`Cannot recognize package manager, please run \`capgo init\` in a capacitor project with npm, pnpm, bun or yarn`)
      pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
      exit()
    }
    // // use pm to install capgo
    // // run command pm install @capgo/capacitor-updater@latest
    //  check if capgo is already installed in node_modules
    const installedVersion = await getInstalledVersion('@capgo/capacitor-updater', path.replace('/package.json', ''), path)
    if (installedVersion) {
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
            if (!value || !existsSync(value))
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
        s.stop('Cannot auto-inject code')
        pLog.warn(`❌ Cannot find import statements in ${mainFilePath}`)
        pLog.info(`💡 You'll need to add the code manually`)
        pLog.info(`📝 Add this to your main file:`)
        pLog.info(`   ${importInject}`)
        pLog.info(`   ${codeInject}`)
        pLog.info(`📚 Or follow: https://capgo.app/docs/getting-started/add-an-app/`)

        const continueAnyway = await pConfirm({
          message: `Continue without auto-injecting the code? (You'll add it manually)`,
        })
        await cancelCommand(continueAnyway, orgId, apikey)

        if (!continueAnyway) {
          pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
          exit()
        }

        pLog.info(`⏭️  Skipping auto-injection - remember to add the code manually!`)
        await markStep(orgId, apikey, 'add-code-manual', appId)
      }
      else if (mainFileContent.includes(codeInject)) {
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

  pLog.info(`🔐 End-to-end encryption`)
  pLog.info(`   ✅ Use this for: Banking, healthcare, or apps with legal encryption requirements`)
  pLog.info(`   ⚠️  Note: Makes debugging harder - skip if you don't need it`)

  const doEncrypt = await pConfirm({
    message: `Enable end-to-end encryption for ${appId} updates?`,
    initialValue: false,
  })
  await cancelCommand(doEncrypt, orgId, apikey)
  if (doEncrypt) {
    if (coreVersion === 'latest') {
      pLog.error(`@capacitor/core version is ${coreVersion}, make sure to use a proper version, using Latest as value is not recommended and will lead to unexpected behavior`)
      return
    }
    if (coreVersion && lessThan(parse(coreVersion), parse('6.0.0'))) {
      pLog.warn(`Encryption is not supported in Capacitor V5.`)
      return
    }

    const s = pSpinner()
    s.start(`Running: ${pm.runner} @capgo/cli@latest key create`)
    const keyRes = await createKeyInternal({ force: true }, false)
    if (!keyRes) {
      s.stop('Error')
      pLog.warn(`Cannot create key ❌`)
      pOutro(`Bye 👋`)
      exit(1)
    }
    else {
      s.stop(`key created 🔑`)
    }
    await markSnag('onboarding-v2', orgId, apikey, 'Use encryption v2', appId)

  }
  await markStep(orgId, apikey, 'add-encryption', appId)
}

async function buildProjectStep(orgId: string, apikey: string, appId: string, platform: 'ios' | 'android') {
  const pm = getPMAndCommand()
  const doBuild = await pConfirm({ message: `Automatic build ${appId} with "${pm.pm} run build" ?` })
  await cancelCommand(doBuild, orgId, apikey)
  if (doBuild) {
    const s = pSpinner()
    s.start(`Checking project type`)
    const projectType = await findProjectType()
    const buildCommand = await findBuildCommandForProjectType(projectType)
    s.message(`Running: ${pm.pm} run ${buildCommand} && ${pm.runner} cap sync ${platform}`)
    const packScripts = getPackageScripts()
    // check in script build exist
    if (!packScripts[buildCommand]) {
      s.stop('Missing build script')
      pLog.warn(`❌ Cannot find "${buildCommand}" script in package.json`)
      pLog.info(`💡 Your package.json needs a "${buildCommand}" script to build the app`)

      const skipBuild = await pConfirm({
        message: `Would you like to skip the build for now and continue? You can build manually later.`,
      })
      await cancelCommand(skipBuild, orgId, apikey)

      if (skipBuild) {
        pLog.info(`⏭️  Skipping build step - you can build manually with: ${pm.pm} run ${buildCommand}`)
        pLog.info(`📝 After building, run: ${pm.runner} cap sync ${platform}`)
        await markStep(orgId, apikey, 'build-project-skipped', appId)
        return
      }

      pOutro(`Bye 👋\n💡 Add a "${buildCommand}" script to package.json and run the command again`)
      exit()
    }
    execSync(`${pm.pm} run ${buildCommand} && ${pm.runner} cap sync ${platform}`, execOption as ExecSyncOptions)

    if (platform === 'ios') {
      const syncValidation = validateIosUpdaterSync(cwd(), globalPathToPackageJson)
      if (syncValidation.shouldCheck && !syncValidation.valid) {
        s.stop('iOS sync check failed ❌')
        stopForBrokenIosSync(pm.runner, syncValidation.details)
      }
    }

    s.stop(`Build & Sync Done ✅`)
  }
  else {
    pLog.info(`Build yourself with command: ${pm.pm} run build && ${pm.runner} cap sync ${platform}`)
  }
  await markStep(orgId, apikey, 'build-project', appId)
}

async function selectPlatformStep(orgId: string, apikey: string): Promise<'ios' | 'android'> {
  pLog.info(`📱 Platform selection for onboarding`)
  pLog.info(`   This is just for testing during onboarding - your app will work on all platforms`)

  const platformType = await pSelect({
    message: 'Which platform do you want to test with during this onboarding?',
    options: [
      { value: 'ios', label: 'IOS' },
      { value: 'android', label: 'Android' },
    ],
  })
  if (pIsCancel(platformType)) {
    await markSnag('onboarding-v2', orgId, apikey, 'canceled', '🤷')
    pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
    exit()
  }

  const platform = platformType as 'ios' | 'android'
  pLog.info(`🎯 Testing with: ${platform.toUpperCase()}`)
  pLog.info(`💡 Note: Onboarding builds will use ${platform} only`)
  await markStep(orgId, apikey, 'select-platform', platform)
  return platform
}

async function runDeviceStep(orgId: string, apikey: string, appId: string, platform: 'ios' | 'android') {
  const pm = getPMAndCommand()
  const doRun = await pConfirm({ message: `Run ${appId} on ${platform.toUpperCase()} device now to test the initial version?` })
  await cancelCommand(doRun, orgId, apikey)
  if (doRun) {
    const s = pSpinner()
    s.start(`Running: ${pm.runner} cap run ${platform}`)
    const runResult = spawnSync(pm.runner, ['cap', 'run', platform], { stdio: 'inherit' })
    const runFailed = runResult.error || runResult.status !== 0

    if (runFailed) {
      const platformName = platform === 'ios' ? 'iOS' : 'Android'
      s.stop(`App failed to start ❌`)
      pLog.error(`The app failed to start on your ${platformName} device.`)

      const openIDE = await pConfirm({
        message: `Would you like to open ${platform === 'ios' ? 'Xcode' : 'Android Studio'} to run the app manually?`,
      })

      if (!pIsCancel(openIDE) && openIDE) {
        const s2 = pSpinner()
        s2.start(`Opening ${platform === 'ios' ? 'Xcode' : 'Android Studio'}...`)
        spawnSync(pm.runner, ['cap', 'open', platform], { stdio: 'inherit' })
        s2.stop(`IDE opened ✅`)
        pLog.info(`Please run the app manually from ${platform === 'ios' ? 'Xcode' : 'Android Studio'}`)
      }
      else {
        pLog.info(`You can run the app manually with: ${pm.runner} cap run ${platform}`)
      }
    }
    else {
      s.stop(`App started ✅`)
      pLog.info(`📱 Your app should now be running on your ${platform} device with Capgo integrated`)
      pLog.info(`🔄 This is your baseline version - we'll create an update next`)
    }
  }
  else {
    pLog.info(`If you change your mind, run it for yourself with: ${pm.runner} cap run ${platform}`)
  }
  await markStep(orgId, apikey, 'run-device', appId)
}

async function addCodeChangeStep(orgId: string, apikey: string, appId: string, pkgVersion: string, platform: 'ios' | 'android', capConfig: any) {
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
    pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
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
  let nextVersion = '1.0.1'
  try {
    const parsed = parse(pkgVersion)
    nextVersion = format(increment(parsed, 'patch'))
  }
  catch {
    nextVersion = '1.0.1'
  }
  pLog.info(`🔢 OTA update versioning:`)
  pLog.info(`   Each upload must use a new version (for example ${pkgVersion} → ${nextVersion})`)
  const versionChoice = await pSelect({
    message: 'How do you want to handle the version for this update?',
    options: [
      { value: 'auto', label: `Auto: Bump patch version (${pkgVersion} → ${nextVersion})` },
      { value: 'manual', label: 'Manual: I\'ll provide the version number' },
    ],
  })
  if (pIsCancel(versionChoice)) {
    await markSnag('onboarding-v2', orgId, apikey, 'canceled', '🤷')
    pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
    exit()
  }

  let newVersion = pkgVersion
  if (versionChoice === 'auto') {
    // Auto bump patch version using semver
    try {
      const parsed = parse(pkgVersion)
      const incrementedVersion = format(increment(parsed, 'patch'))
      newVersion = incrementedVersion
      pLog.info(`🔢 Auto-bumped version from ${pkgVersion} to ${newVersion}`)
    }
    catch {
      newVersion = '1.0.1' // fallback
      pLog.warn(`Could not parse version ${pkgVersion}, using fallback ${newVersion}`)
    }
  }
  else {
    const userVersion = await pText({
      message: `Current version is ${pkgVersion}. Enter new version:`,
      validate: (value) => {
        if (!value?.match(/^\d+\.\d+\.\d+/))
          return 'Please enter a valid version (x.y.z)'
      },
    })
    if (pIsCancel(userVersion)) {
      await markSnag('onboarding-v2', orgId, apikey, 'canceled', '🤷')
      pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
      exit()
    }
    newVersion = userVersion as string
  }
  pLog.info(`🧭 This OTA upload will use version ${newVersion}. For the next test, increment it again.`)
  const likelyMajorBlockWarning = getLikelyMajorBlockWarning(capConfig, newVersion)
  if (likelyMajorBlockWarning) {
    pLog.warn(`⚠️  ${likelyMajorBlockWarning}`)
    pLog.warn('If this app should receive this OTA, align CapacitorUpdater.version with the installed native app version and rebuild native before retrying.')
  }

  // Build after modifications
  const pm = getPMAndCommand()
  const projectType = await findProjectType()
  const buildCommand = await findBuildCommandForProjectType(projectType)
  const printManualOtaBuildInstructions = () => {
    pLog.info(`Build web assets manually with: ${pm.pm} run ${buildCommand}`)
    pLog.warn(`Do NOT run "${pm.runner} cap sync ${platform}" for this OTA test.`)
    pLog.warn(`Why: "${pm.runner} cap sync ${platform}" copies the current web build into the native project and regenerates native plugin files.`)
    pLog.warn('If you sync now, the native app already contains your new change before Capgo download, so you cannot verify OTA behavior.')
    pLog.info('Sync is safe again only after you confirmed the OTA update on device, or when preparing a new native/App Store build.')
  }

  const doBuild = await pConfirm({
    message: `Build ${appId} web assets before uploading with "${pm.pm} run ${buildCommand}"? (no cap sync)`,
  })
  await cancelCommand(doBuild, orgId, apikey)
  if (doBuild) {
    const s = pSpinner()
    s.start(`Running: ${pm.pm} run ${buildCommand}`)
    const packScripts = getPackageScripts()
    // check in script build exist
    if (!packScripts[buildCommand]) {
      s.stop('Missing build script')
      pLog.warn(`❌ Cannot find "${buildCommand}" script in package.json`)
      pLog.info(`💡 Build manually in another terminal, then come back and continue`)
      printManualOtaBuildInstructions()

      const builtManually = await pConfirm({
        message: `Have you built the app manually? (If not, we'll skip the build)`,
      })
      await cancelCommand(builtManually, orgId, apikey)

      if (!builtManually) {
        pLog.warn(`⚠️  Continuing without build - upload may fail if app isn't built`)
        printManualOtaBuildInstructions()
      }
      else {
        pLog.info(`✅ Great! Continuing with your manual build`)
      }
    }
    else {
      try {
        const buildResult = spawnSync(pm.pm, ['run', buildCommand], { stdio: 'pipe' })
        if (buildResult.error) {
          throw buildResult.error
        }
        if (buildResult.status !== 0) {
          throw new Error(`Build command "${pm.pm} run ${buildCommand}" failed with exit code ${buildResult.status ?? 'unknown'}`)
        }
        s.stop(`✅ Build with changes completed`)
        pLog.info(`📦 Your modifications are built and ready for OTA upload`)
      }
      catch {
        s.stop('Build failed ❌')
        pLog.warn('Automatic build failed.')
        printManualOtaBuildInstructions()

        const builtManually = await pConfirm({
          message: 'Have you built the app manually now? (If not, we will continue without build)',
        })
        await cancelCommand(builtManually, orgId, apikey)

        if (!builtManually) {
          pLog.warn(`⚠️  Continuing without build - upload may fail if app isn't built`)
        }
      }
    }
  }
  else {
    printManualOtaBuildInstructions()
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
        pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
        exit(1)
      }
    }
    const uploadRes = await uploadBundleInternal(appId, {
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
      pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
      exit()
    }
    else {
      s.stop(`✅ Update v${newVersion} uploaded successfully!`)
      pLog.info(`🎉 Your updated bundle is now available on Capgo`)
      pLog.info(`For your next self-test:`)
      pLog.info(`1. Make a new visible change`)
      pLog.info(`2. Build web assets only: ${pm.pm} run build`)
      pLog.info(`3. Upload with a new version: ${pm.runner} @capgo/cli@latest bundle upload --bundle <new-version> --channel ${defaultChannel}`)
      pLog.warn(`Do not run "${pm.runner} cap sync" before validating the OTA update.`)
      pLog.warn('Reason: sync puts your local build directly in the native app, which bypasses the Capgo OTA path you are trying to test.')
    }
  }
  else {
    pLog.info(`Upload yourself with command: ${pm.runner} @capgo/cli@latest bundle upload`)
  }
  await markStep(orgId, apikey, 'upload', appId)
}

async function testCapgoUpdateStep(orgId: string, apikey: string, appId: string, hostWeb: string, delta: boolean, platform: 'ios' | 'android', capConfig: any) {
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

  pLog.info('ℹ️  Capgo cache can take up to about one minute before update visibility is consistent during onboarding checks.')
  const doWaitForAvailability = await pConfirm({ message: 'Wait in CLI and poll update availability every 5 seconds for up to 1 minute?' })
  await cancelCommand(doWaitForAvailability, orgId, apikey)

  if (doWaitForAvailability) {
    const prepared = await prepareUpdateProbe(platform, capConfig, appId, globalPathToPackageJson)
    if (!prepared.ok) {
      pLog.error(`❌ CLI update-availability check failed before polling: ${prepared.error}`)
      pLog.warn('The real app update may still work, but CLI could not resolve the contract values needed for the updates endpoint.')
    }
    else {
      const probe = prepared.context
      pLog.info(`🔎 Probing updates endpoint: ${probe.endpoint}`)
      pLog.info(`🧩 Using platform=${probe.payload.platform}, version_name=${probe.payload.version_name}, version_build=${probe.payload.version_build}, device_id=${probe.payload.device_id}`)
      pLog.info(`🧭 version_build source: ${probe.versionBuildSource}`)
      pLog.info(`🧭 app_id source: ${probe.appIdSource}`)
      pLog.info(`🗂️  Native values source: ${probe.nativeSource}`)
      const spinner = pSpinner()
      spinner.start('Waiting for update to become available (max 60s)...')

      const result = await pollUpdateAvailability(probe.endpoint, probe.payload)

      if (result.success) {
        spinner.stop(`✅ Update detected after ${result.attempt} check(s). Available version: ${result.availableVersion}`)
      }
      else {
        spinner.stop('❌ Update was not confirmed by CLI polling')
        pLog.warn(`CLI could not ensure update availability within one minute: ${result.reason}`)
        if (result.backendRefusal)
          pLog.warn('The updates endpoint responded and refused the request, so this is not just cache propagation delay.')
        if (result.errorCode)
          pLog.warn(`Backend error code: ${result.errorCode}`)
        if (result.backendMessage)
          pLog.warn(`Backend message: ${result.backendMessage}`)
        const hints = explainCommonUpdateError(result)
        for (const hint of hints)
          pLog.warn(`   • ${hint}`)
        pLog.warn('Your real app may still receive the update, but CLI endpoint verification failed with the current probe values/response.')
      }
    }
  }

  const doWaitLogs = await pConfirm({ message: `Monitor Capgo logs to verify the update worked?` })
  await cancelCommand(doWaitLogs, orgId, apikey)

  if (doWaitLogs) {
    pLog.info(`📊 Watching logs from ${appId}...`)
    pLog.info(`🔄 Please background and reopen your app now to trigger the update`)
    await waitLog('onboarding-v2', apikey, appId, apikey, orgId)
  }
  else {
    pLog.info(`📊 Check logs manually at ${hostWeb}/app/${appId}/logs to verify the update`)
  }
  await markStep(orgId, apikey, 'test-update', appId)
}

export async function initApp(apikeyCommand: string, appId: string, options: SuperOptions) {
  const pm = getPMAndCommand()
  pIntro(`Capgo onboarding 🛫`)
  pLog.info(`📖 See the complete onboarding guide: https://capgo.app/docs/getting-started/onboarding/`)
  pLog.info(`⏱️  Estimated time: 10-20 minutes`)
  await warnIfNotInCapacitorRoot()
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
    await loginInternal(options.apikey, options, false)
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
  let platform: 'ios' | 'android' = 'ios' // default

  const totalSteps = 13

  if (stepToSkip > 0) {
    pLog.info(`\n🔄 Resuming onboarding from step ${stepToSkip + 1}/${totalSteps}`)
  }

  try {
    if (stepToSkip < 1) {
      pLog.info(`\n📍 Step 1/${totalSteps}: Check Prerequisites`)
      await checkPrerequisitesStep(orgId, options.apikey)
      markStepDone(1)
    }

    if (stepToSkip < 2) {
      pLog.info(`\n📍 Step 2/${totalSteps}: Add Your App`)
      appId = await addAppStep(organization, options.apikey, appId, options)
      markStepDone(2)
    }

    if (stepToSkip < 3) {
      pLog.info(`\n📍 Step 3/${totalSteps}: Create Production Channel`)
      await addChannelStep(orgId, options.apikey, appId)
      markStepDone(3)
    }

    if (stepToSkip < 4) {
      pLog.info(`\n📍 Step 4/${totalSteps}: Install Updater Plugin`)
      const res = await addUpdaterStep(orgId, options.apikey, appId)
      pkgVersion = res.pkgVersion
      currentVersion = pkgVersion
      delta = res.delta
      markStepDone(4)
    }

    if (stepToSkip < 5) {
      pLog.info(`\n📍 Step 5/${totalSteps}: Add Integration Code`)
      await addCodeStep(orgId, options.apikey, appId)
      markStepDone(5)
    }

    if (stepToSkip < 6) {
      pLog.info(`\n📍 Step 6/${totalSteps}: Setup Encryption (Optional)`)
      await addEncryptionStep(orgId, options.apikey, appId)
      markStepDone(6)
    }

    if (stepToSkip < 7) {
      pLog.info(`\n📍 Step 7/${totalSteps}: Select Platform`)
      platform = await selectPlatformStep(orgId, options.apikey)
      markStepDone(7)
    }

    if (stepToSkip < 8) {
      pLog.info(`\n📍 Step 8/${totalSteps}: Build Your Project`)
      await buildProjectStep(orgId, options.apikey, appId, platform)
      markStepDone(8)
    }

    if (stepToSkip < 9) {
      pLog.info(`\n📍 Step 9/${totalSteps}: Run on Device`)
      await runDeviceStep(orgId, options.apikey, appId, platform)
      markStepDone(9)
    }

    if (stepToSkip < 10) {
      pLog.info(`\n📍 Step 10/${totalSteps}: Make a Test Change`)
      currentVersion = await addCodeChangeStep(orgId, options.apikey, appId, pkgVersion, platform, extConfig?.config)
      markStepDone(10)
    }

    if (stepToSkip < 11) {
      pLog.info(`\n📍 Step 11/${totalSteps}: Upload Bundle`)
      await uploadStep(orgId, options.apikey, appId, currentVersion, delta)
      markStepDone(11)
    }

    if (stepToSkip < 12) {
      pLog.info(`\n📍 Step 12/${totalSteps}: Test Update on Device`)
      await testCapgoUpdateStep(orgId, options.apikey, appId, localConfig.hostWeb, delta, platform, extConfig?.config)
      markStepDone(12)
    }

    if (stepToSkip < 13) {
      pLog.info(`\n📍 Step 13/${totalSteps}: Completion`)
      markStepDone(13)
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
