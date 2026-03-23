import type { ExecSyncOptions } from 'node:child_process'
import type { Options, PendingOnboardingApp } from '../api/app'
import type { Organization } from '../utils'
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path, { dirname, join } from 'node:path'
import { cwd, env, exit, platform, stdin, stdout } from 'node:process'
import { canParse, format, increment, lessThan, parse } from '@std/semver'
import tmp from 'tmp'
import { checkAppIdsExist, completePendingOnboardingApp, listPendingOnboardingApps } from '../api/app'
import { checkVersionStatus } from '../api/update'
import { addAppInternal } from '../app/add'
import { markSnag, waitLog } from '../app/debug'
import { canUseFilePicker, openPackageJsonPicker } from '../build/onboarding/file-picker'
import { uploadBundleInternal } from '../bundle/upload'
import { addChannelInternal } from '../channel/add'
import { writeConfigUpdater } from '../config'
import { getRepoStarStatus, isRepoStarredInSession, starAllRepositories, starRepository } from '../github'
import { createKeyInternal } from '../key'
import { doLoginExists, loginInternal } from '../login'
import { showReplicationProgress } from '../replicationProgress'
import { createSupabaseClient, findBuildCommandForProjectType, findMainFile, findMainFileForProjectType, findProjectType, findRoot, findSavedKey, formatError, getAllPackagesDependencies, getAppId, getBundleVersion, getConfig, getInstalledVersion, getLocalConfig, getNativeProjectResetAdvice, getPackageScripts, getPMAndCommand, PACKNAME, projectIsMonorepo, updateConfigbyKey, updateConfigUpdater, validateIosUpdaterSync, verifyUser } from '../utils'
import { cancel as pCancel, confirm as pConfirm, intro as pIntro, isCancel as pIsCancel, log as pLog, outro as pOutro, select as pSelect, spinner as pSpinner, text as pText } from './prompts'
import { setInitVersionWarning, stopInitInkSession } from './runtime'
import { formatInitResumeMessage, initOnboardingSteps, renderInitOnboardingComplete, renderInitOnboardingFrame, renderInitOnboardingWelcome } from './ui'

interface SuperOptions extends Options {
  local: boolean
}
const importInject = 'import { CapacitorUpdater } from \'@capgo/capacitor-updater\''
const codeInject = 'CapacitorUpdater.notifyAppReady()'
// create regex to find line who start by 'import ' and end by ' from '
const regexImport = /import.*from.*/g
const defaultChannel = 'production'
const channelNameRegex = /^[\w.-]+$/
const appIdRegex = /^[a-z0-9]+(?:\.[\w-]+)+$/i
const execOption = { stdio: 'pipe' }
const capacitorConfigFiles = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json']
const capacitorGettingStartedUrl = 'https://capacitorjs.com/docs/getting-started'
const nextWebDirPattern = /["']?webDir["']?\s*:\s*["']out["']/
const nuxtWebDirPattern = /["']?webDir["']?\s*:\s*["']\.output\/public["']/
const frameworkSetupGuides = {
  nextjs: 'https://capgo.app/blog/nextjs-mobile-app-capacitor-from-scratch/',
  nuxtjs: 'https://capgo.app/blog/nuxt-mobile-app-capacitor-from-scratch/',
  sveltekit: 'https://capgo.app/blog/creating-mobile-apps-with-sveltekit-and-capacitor/',
} as const

let tmpObject: tmp.FileResult['name'] | undefined
let globalPathToPackageJson: string | undefined
let globalChannelName = defaultChannel
let globalPlatform: 'ios' | 'android' = 'ios'
let globalDelta = false
let globalCurrentVersion: string | undefined

function readTmpObj() {
  tmpObject ??= readdirSync(tmp.tmpdir)
    .map((name) => { return { name, full: `${tmp.tmpdir}/${name}` } })
    .find(obj => obj.name.startsWith('capgocli'))
    ?.full
    ?? tmp.fileSync({ prefix: 'capgocli' }).name
}

function getTmpObjectPath() {
  readTmpObj()
  if (!tmpObject)
    throw new Error('Unable to allocate onboarding state file')
  return tmpObject
}

function findNearestNamedFile(startDir: string, fileNames: string[]) {
  let currentDir = startDir
  const rootDir = path.parse(currentDir).root

  while (true) {
    for (const fileName of fileNames) {
      const candidate = join(currentDir, fileName)
      if (existsSync(candidate))
        return candidate
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

function findNearestPackageJson(startDir: string) {
  return findNearestNamedFile(startDir, [PACKNAME])
}

function readExistingFile(filePath: string | undefined) {
  if (!filePath || !existsSync(filePath))
    return undefined
  return readFileSync(filePath, 'utf8')
}

function getFrameworkKind(projectType: string): keyof typeof frameworkSetupGuides | undefined {
  if (projectType.startsWith('nextjs-'))
    return 'nextjs'
  if (projectType.startsWith('nuxtjs-'))
    return 'nuxtjs'
  if (projectType.startsWith('sveltekit-'))
    return 'sveltekit'
  return undefined
}

function getFrameworkDisplayName(projectType: string) {
  const frameworkKind = getFrameworkKind(projectType)
  if (frameworkKind === 'nextjs')
    return 'Next.js'
  if (frameworkKind === 'nuxtjs')
    return 'Nuxt'
  if (frameworkKind === 'sveltekit')
    return 'SvelteKit'
  return 'web'
}

function getSuggestedWebDir(projectType: string) {
  const frameworkKind = getFrameworkKind(projectType)
  if (frameworkKind === 'nextjs')
    return 'out'
  if (frameworkKind === 'nuxtjs')
    return '.output/public'
  if (frameworkKind === 'sveltekit')
    return 'build'
  return 'dist'
}

function getPackageJsonData(packageJsonPath: string | undefined) {
  if (!packageJsonPath || !existsSync(packageJsonPath))
    return undefined

  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }
  }
  catch {
    return undefined
  }
}

function getSuggestedAppName(projectDir: string) {
  const packageJson = getPackageJsonData(findNearestPackageJson(projectDir))
  const rawName = packageJson?.name?.split('/').pop() || path.basename(projectDir)
  return rawName
    .replaceAll(/[-_]+/g, ' ')
    .replaceAll(/\b\w/g, char => char.toUpperCase())
}

function getFrameworkSetupIssues(projectType: string, projectDir: string, capacitorConfigPath?: string) {
  const frameworkKind = getFrameworkKind(projectType)
  if (!frameworkKind)
    return []

  const issues: string[] = []

  if (frameworkKind === 'nextjs') {
    const nextConfig = readExistingFile(findNearestNamedFile(projectDir, ['next.config.ts', 'next.config.js', 'next.config.mjs']))
    if (!nextConfig?.includes('output') || !nextConfig.includes('export')) {
      issues.push('Next.js must use static export (`output: \'export\'`).')
    }
    const capacitorConfig = readExistingFile(capacitorConfigPath)
    if (capacitorConfig && !nextWebDirPattern.test(capacitorConfig)) {
      issues.push('Capacitor `webDir` should point to `out` for Next.js.')
    }
  }

  if (frameworkKind === 'nuxtjs') {
    const nuxtConfig = readExistingFile(findNearestNamedFile(projectDir, ['nuxt.config.ts', 'nuxt.config.js']))
    if (!nuxtConfig?.includes('preset') || !nuxtConfig.includes('static')) {
      issues.push('Nuxt must use static Nitro output (`nitro.preset = "static"`).')
    }
    const capacitorConfig = readExistingFile(capacitorConfigPath)
    if (capacitorConfig && !nuxtWebDirPattern.test(capacitorConfig)) {
      issues.push('Capacitor `webDir` should point to `.output/public` for Nuxt.')
    }
  }

  if (frameworkKind === 'sveltekit') {
    const svelteConfig = readExistingFile(findNearestNamedFile(projectDir, ['svelte.config.js', 'svelte.config.ts']))
    if (!svelteConfig?.includes('adapter-static')) {
      issues.push('SvelteKit must use `@sveltejs/adapter-static` before Capacitor sync works reliably.')
    }
  }

  return issues
}

function exitBeforeAuthenticatedOnboarding() {
  pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
  exit(1)
}

function cancelBeforeAuthenticatedOnboarding(command: boolean | string | symbol) {
  if (pIsCancel(command)) {
    pCancel('Operation cancelled.')
    exitBeforeAuthenticatedOnboarding()
  }
}

async function waitUntilSetupIsDone(message = 'Type "ready" when the setup is done.') {
  while (true) {
    const ready = await pText({
      message,
      placeholder: 'ready',
      validate: (value) => {
        if (!value?.trim())
          return 'Type "ready" when you are done.'
        if (value.trim().toLowerCase() !== 'ready')
          return 'Type "ready" when you are done.'
      },
    })
    cancelBeforeAuthenticatedOnboarding(ready)
    if ((ready as string).trim().toLowerCase() === 'ready')
      return
  }
}

async function askForAppName(message: string, initialValue: string) {
  const appName = await pText({
    message,
    placeholder: initialValue,
    validate: (value) => {
      if (!value?.trim())
        return 'App name is required'
    },
  })
  cancelBeforeAuthenticatedOnboarding(appName)
  return (appName as string).trim()
}

async function askForWebDir(projectType: string) {
  const suggestedWebDir = getSuggestedWebDir(projectType)
  const webDir = await pText({
    message: 'Enter the web build directory to use for Capacitor:',
    placeholder: suggestedWebDir,
    validate: (value) => {
      if (!value?.trim())
        return 'Web directory is required'
    },
  })
  cancelBeforeAuthenticatedOnboarding(webDir)
  return (webDir as string).trim()
}

async function maybeRunCapacitorInit(projectDir: string, projectType: string, initialAppId?: string) {
  const shouldInitCapacitor = await pConfirm({
    message: 'Do you want me to install Capacitor here and run init now?',
    initialValue: true,
  })
  cancelBeforeAuthenticatedOnboarding(shouldInitCapacitor)

  if (!shouldInitCapacitor)
    exitBeforeAuthenticatedOnboarding()

  const appName = await askForAppName('App name for Capacitor:', getSuggestedAppName(projectDir))
  const capacitorAppId = initialAppId || await askForAppId('Enter your appId for Capacitor:')
  const webDir = await askForWebDir(projectType)
  const spinner = pSpinner()
  const pm = getPMAndCommand()

  try {
    spinner.start(`Installing Capacitor packages with ${pm.installCommand}`)
    const installCoreResult = spawnSync(pm.pm, [pm.command, '@capacitor/core'], { stdio: 'pipe', cwd: projectDir })
    if (installCoreResult.error)
      throw installCoreResult.error
    if (installCoreResult.status !== 0) {
      const stderr = installCoreResult.stderr?.toString().trim()
      const stdout = installCoreResult.stdout?.toString().trim()
      throw new Error(stderr || stdout || `${pm.installCommand} @capacitor/core exited with code ${installCoreResult.status}`)
    }

    const installCliResult = spawnSync(pm.pm, [pm.command, '-D', '@capacitor/cli'], { stdio: 'pipe', cwd: projectDir })
    if (installCliResult.error)
      throw installCliResult.error
    if (installCliResult.status !== 0) {
      const stderr = installCliResult.stderr?.toString().trim()
      const stdout = installCliResult.stdout?.toString().trim()
      throw new Error(stderr || stdout || `${pm.installCommand} -D @capacitor/cli exited with code ${installCliResult.status}`)
    }

    spinner.message(`Running: ${pm.runner} cap init "${appName}" "${capacitorAppId}" --web-dir ${webDir}`)
    const initResult = spawnSync(pm.runner, ['cap', 'init', appName, capacitorAppId, '--web-dir', webDir], { stdio: 'pipe', cwd: projectDir })
    if (initResult.error)
      throw initResult.error
    if (initResult.status !== 0) {
      const stderr = initResult.stderr?.toString().trim()
      const stdout = initResult.stdout?.toString().trim()
      throw new Error(stderr || stdout || `cap init exited with code ${initResult.status}`)
    }
    spinner.stop('Capacitor init done ✅')
    pLog.info(`Capacitor was initialized with webDir ${webDir}.`)
    return capacitorAppId
  }
  catch (error) {
    spinner.stop('Capacitor init failed ❌')
    pLog.error(formatError(error))
    const retry = await pConfirm({
      message: 'Capacitor init failed. Do you want to try again?',
      initialValue: true,
    })
    cancelBeforeAuthenticatedOnboarding(retry)
    if (retry)
      return maybeRunCapacitorInit(projectDir, projectType, capacitorAppId)
    exitBeforeAuthenticatedOnboarding()
  }
}

function runCreateAppTemplate() {
  stopInitInkSession({ text: 'Starting Capacitor app template creation...', tone: 'green' })
  const result = spawnSync('npm', ['init', '@capacitor/app@latest'], { stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    stdout.write('Capacitor app template creation failed. Run npm init @capacitor/app@latest manually and try again.\n')
    exit(1)
  }

  stdout.write('Capacitor app template creation finished. Run init again from the new app folder.\n')
  exit(0)
}

async function ensureWorkspaceReadyForInit(initialAppId?: string): Promise<string | undefined> {
  while (true) {
    const currentDir = cwd()
    const nearestCapacitorConfig = findNearestCapacitorConfig(currentDir)
    const nearestPackageJson = findNearestPackageJson(currentDir)
    const projectDir = nearestCapacitorConfig?.dir || (nearestPackageJson ? dirname(nearestPackageJson) : currentDir)
    const projectType = await findProjectType({ quiet: true })
    const frameworkKind = getFrameworkKind(projectType)

    if (nearestCapacitorConfig?.dir === currentDir) {
      const frameworkIssues = getFrameworkSetupIssues(projectType, projectDir, nearestCapacitorConfig.file)
      if (frameworkIssues.length === 0)
        return

      pLog.warn(`${getFrameworkDisplayName(projectType)} is detected, but the Capacitor setup is not ready yet.`)
      for (const issue of frameworkIssues) {
        pLog.warn(issue)
      }
      if (frameworkKind) {
        pLog.info(`Follow this guide to finish the setup: ${frameworkSetupGuides[frameworkKind]}`)
      }
      await waitUntilSetupIsDone()
      continue
    }

    if (nearestCapacitorConfig) {
      return
    }

    if (frameworkKind) {
      const frameworkIssues = getFrameworkSetupIssues(projectType, projectDir)
      if (frameworkIssues.length > 0) {
        pLog.warn(`${getFrameworkDisplayName(projectType)} project detected, but the setup is not ready yet.`)
        for (const issue of frameworkIssues) {
          pLog.warn(issue)
        }
        pLog.info(`Follow this guide: ${frameworkSetupGuides[frameworkKind]}`)
        await waitUntilSetupIsDone()
        continue
      }

      const initializedAppId = await maybeRunCapacitorInit(projectDir, projectType, initialAppId)
      return initializedAppId
    }

    if (nearestPackageJson) {
      pLog.warn('This looks like a web app, but Capacitor is not initialized yet.')
      pLog.info(`Follow the Capacitor getting started guide: ${capacitorGettingStartedUrl}`)
      const initializedAppId = await maybeRunCapacitorInit(projectDir, projectType, initialAppId)
      return initializedAppId
    }

    const createAppNow = await pConfirm({
      message: 'This folder is not a web app yet. Do you want to start npm init @capacitor/app@latest now?',
      initialValue: true,
    })
    cancelBeforeAuthenticatedOnboarding(createAppNow)
    if (createAppNow) {
      runCreateAppTemplate()
    }
    else {
      pLog.info('Create a new Capacitor app first with: npm init @capacitor/app@latest')
      pLog.info('Then run this onboarding again from the new app folder.')
      exitBeforeAuthenticatedOnboarding()
    }
  }
}

function markStepDone(step: number, pathToPackageJson?: string, channelName?: string) {
  try {
    writeFileSync(getTmpObjectPath(), JSON.stringify({
      step_done: step,
      pathToPackageJson: pathToPackageJson ?? globalPathToPackageJson,
      channelName: channelName ?? globalChannelName,
      platform: globalPlatform,
      delta: globalDelta,
      currentVersion: globalCurrentVersion,
    }))
    if (pathToPackageJson) {
      globalPathToPackageJson = pathToPackageJson
    }
    if (channelName) {
      globalChannelName = channelName
    }
  }
  catch (err) {
    pLog.error(`Cannot mark step as done in the CLI, error:\n${err}`)
    pLog.warn('Onboarding will continue but please report it to the capgo team!')
  }
}

async function readStepsDone(orgId: string, apikey: string): Promise<number | undefined> {
  try {
    const rawData = readFileSync(getTmpObjectPath(), 'utf-8')
    if (!rawData || rawData.length === 0)
      return undefined

    const { step_done, pathToPackageJson, channelName, platform, delta, currentVersion } = JSON.parse(rawData)
    pLog.info(formatInitResumeMessage(step_done, initOnboardingSteps.length))
    const skipSteps = await pConfirm({ message: 'Would you like to continue from where you left off?' })
    await cancelCommand(skipSteps, orgId, apikey)
    if (skipSteps) {
      if (pathToPackageJson) {
        globalPathToPackageJson = pathToPackageJson
      }
      if (channelName) {
        globalChannelName = channelName
      }
      if (platform === 'ios' || platform === 'android') {
        globalPlatform = platform
      }
      if (typeof delta === 'boolean') {
        globalDelta = delta
      }
      if (typeof currentVersion === 'string' && currentVersion.length > 0) {
        globalCurrentVersion = currentVersion
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

async function cancelCommand(command: boolean | string | symbol, orgId: string, apikey: string) {
  if (pIsCancel(command)) {
    await markSnag('onboarding-v2', orgId, apikey, 'canceled', undefined, '🤷')
    pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
    exit()
  }
}

interface RecoveryOption<T extends string> {
  value: T
  label: string
  hint?: string
}

async function selectRecoveryOption<T extends string>(
  orgId: string,
  apikey: string,
  message: string,
  options: RecoveryOption<T>[],
): Promise<T> {
  type RecoveryChoice = T | '__cancel__'
  const choice = await pSelect<RecoveryChoice>({
    message,
    options: [
      ...options,
      { value: '__cancel__', label: 'Exit onboarding' },
    ],
  })

  if (pIsCancel(choice) || choice === '__cancel__') {
    await markSnag('onboarding-v2', orgId, apikey, 'canceled', undefined, '🤷')
    pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
    exit(1)
  }

  return choice as T
}

async function askForExistingDirectoryPath(orgId: string, apikey: string, message: string, placeholder?: string): Promise<string> {
  const selectedPath = await pText({
    message,
    placeholder,
    validate: (value) => {
      const trimmedValue = value?.trim()
      if (!trimmedValue)
        return 'Path is required.'
      if (!existsSync(trimmedValue))
        return `Path ${trimmedValue} does not exist`
      if (!statSync(trimmedValue).isDirectory())
        return 'Selected path is not a directory'
    },
  })

  if (pIsCancel(selectedPath)) {
    await cancelCommand(selectedPath, orgId, apikey)
  }

  return (selectedPath as string).trim()
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

/**
 * When reusing an app created by the web onboarding flow, the dashboard app ID becomes authoritative.
 */
async function syncPendingAppIdToCapacitorConfig(appId: string) {
  try {
    const extConfig = await getConfig()
    extConfig.config.appId = appId
    extConfig.config.plugins ||= {}
    extConfig.config.plugins.CapacitorUpdater = {
      ...extConfig.config.plugins.CapacitorUpdater,
      appId,
    }
    await writeConfigUpdater(extConfig, true)
    pLog.info(`💾 Synced pending onboarding app ID "${appId}" to capacitor config`)
  }
  catch (err) {
    pLog.warn(`⚠️  Could not save app ID to capacitor config: ${err}`)
    pLog.info(`   You may need to manually update your capacitor.config file with the new app ID: ${appId}`)
  }
}

async function handleBrokenIosSync(platformRunner: string, details: string[], orgId: string, apikey: string, failureCount: number) {
  const resetAdvice = getNativeProjectResetAdvice(platformRunner, 'ios')
  pLog.error('Capgo iOS dependency sync verification failed.')
  for (const detail of details) {
    pLog.error(detail)
  }
  pLog.error('The native iOS project is still broken, so this build step cannot continue yet.')
  pLog.warn(resetAdvice.summary)
  pLog.info(resetAdvice.command)

  if (failureCount % 3 === 0) {
    const cancelInit = await pConfirm({
      message: `iOS sync has failed ${failureCount} times. Do you want to cancel init?`,
      initialValue: false,
    })
    await cancelCommand(cancelInit, orgId, apikey)
    if (cancelInit) {
      await markSnag('onboarding-v2', orgId, apikey, 'canceled', undefined, '🤷')
      pOutro('Bye 👋\n💡 You can resume the onboarding anytime by running the same command again')
      exit(1)
    }
  }

  const runResetNow = await pConfirm({
    message: 'Would you like me to run this reset command for you now?',
    initialValue: true,
  })
  await cancelCommand(runResetNow, orgId, apikey)

  if (runResetNow) {
    const resetSpinner = pSpinner()
    resetSpinner.start(`Running: ${resetAdvice.command}`)
    try {
      execSync(resetAdvice.command, execOption as ExecSyncOptions)
      resetSpinner.stop('iOS folder recreated and synced ✅')
    }
    catch (err) {
      resetSpinner.stop('iOS folder reset failed ❌')
      pLog.error(formatError(err))
    }
    return
  }

  pLog.info('We will wait while you fix the iOS folder yourself.')
  pLog.info('When you are ready, type "ready" and I will retry this step.')

  while (true) {
    const ready = await pText({
      message: 'Type "ready" when the iOS folder is fixed.',
      placeholder: 'ready',
      validate: (value) => {
        if (!value?.trim())
          return 'Type "ready" to retry.'
        if (value.trim().toLowerCase() !== 'ready')
          return 'Type "ready" to retry.'
      },
    })
    if (pIsCancel(ready)) {
      await cancelCommand(ready, orgId, apikey)
    }
    if ((ready as string).trim().toLowerCase() === 'ready') {
      return
    }
  }
}

function validateAppId(value: string | undefined): string | undefined {
  if (!value)
    return 'App ID is required'
  if (value.includes('--'))
    return 'App ID cannot contain "--"'
  if (!appIdRegex.test(value))
    return 'Invalid format. Use reverse domain notation (e.g., com.example.app)'
}

function validateChannelName(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim()
  if (!trimmedValue)
    return 'Channel name is required'
  if (!channelNameRegex.test(trimmedValue))
    return 'Use only letters, numbers, dot, dash, or underscore'
}

function normalizeConcreteVersion(version: string | undefined) {
  if (!version)
    return undefined

  const trimmedVersion = version.trim()
  if (!trimmedVersion || trimmedVersion === 'latest')
    return undefined
  if (canParse(trimmedVersion))
    return format(parse(trimmedVersion))

  const fallbackMatch = /\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?/i.exec(trimmedVersion)
  if (!fallbackMatch?.[0])
    return undefined
  if (!canParse(fallbackMatch[0]))
    return undefined
  return format(parse(fallbackMatch[0]))
}

async function askForAppId(message = 'Enter your appId:'): Promise<string> {
  const appId = await pText({
    message,
    validate: validateAppId,
  })

  if (pIsCancel(appId)) {
    pCancel('Operation cancelled.')
    pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
    exit()
  }

  return appId as string
}

async function ensureCapacitorProjectReady(
  orgId: string,
  apikey: string,
  appId: string,
  pendingApp?: PendingOnboardingApp,
) {
  const nearestConfig = findNearestCapacitorConfig(cwd())
  if (nearestConfig?.dir === cwd()) {
    return
  }

  if (nearestConfig) {
    await warnIfNotInCapacitorRoot()
    return
  }

  if (pendingApp?.existing_app === false) {
    const pm = getPMAndCommand()
    const appName = pendingApp.name?.trim() || appId
    pLog.info(`No Capacitor config was found for ${appId}.`)
    pLog.info('This app was created from the web onboarding as a new app.')

    const initCommand = `${pm.runner} cap init "${appName}" "${appId}"`
    const shouldInitCapacitor = await pConfirm({
      message: `Do you want me to run "${initCommand}" now?`,
      initialValue: true,
    })
    await cancelCommand(shouldInitCapacitor, orgId, apikey)

    if (shouldInitCapacitor) {
      const spinner = pSpinner()
      spinner.start(`Running: ${pm.runner} cap init "${appName}" "${appId}"`)
      try {
        const initResult = spawnSync(pm.runner, ['cap', 'init', appName, appId], { stdio: 'pipe' as const })
        if (initResult.error)
          throw initResult.error
        if (initResult.status !== 0) {
          const stderr = initResult.stderr?.toString().trim()
          const stdout = initResult.stdout?.toString().trim()
          throw new Error(stderr || stdout || `cap init exited with code ${initResult.status}`)
        }
        spinner.stop('Capacitor init done ✅')
        await saveAppIdToCapacitorConfig(appId)
        return
      }
      catch (error) {
        spinner.stop('Capacitor init failed ❌')
        throw error
      }
    }
  }

  await warnIfNotInCapacitorRoot()
}

async function selectPendingOnboardingApp(
  orgId: string,
  apikey: string,
  requestedAppId: string | undefined,
  pendingApps: PendingOnboardingApp[],
) {
  const requestedApp = requestedAppId
    ? pendingApps.find(app => app.app_id === requestedAppId)
    : undefined

  if (requestedApp) {
    const useRequestedApp = await pConfirm({
      message: `Use the pending onboarding app "${requestedApp.name || requestedApp.app_id}" (${requestedApp.app_id}) from the web console?`,
      initialValue: true,
    })
    await cancelCommand(useRequestedApp, orgId, apikey)
    return useRequestedApp ? requestedApp : undefined
  }

  if (pendingApps.length === 0) {
    return undefined
  }

  const selectedAppId = await pSelect({
    message: 'A pending onboarding app already exists in Capgo. What do you want to do?',
    options: [
      ...pendingApps.map(app => ({
        value: app.app_id,
        label: `${app.name || app.app_id} (${app.app_id})`,
        hint: app.existing_app ? 'Existing app' : 'New app created from web onboarding',
      })),
      { value: '__create_new__', label: 'Create a new app from the CLI' },
    ],
  })

  await cancelCommand(selectedAppId, orgId, apikey)

  if (selectedAppId === '__create_new__') {
    return undefined
  }

  return pendingApps.find(app => app.app_id === selectedAppId)
}

async function maybeReusePendingOnboardingApp(
  organization: Organization,
  apikey: string,
  appId: string | undefined,
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
) {
  const pendingApps = await listPendingOnboardingApps(supabase, organization.gid)
  const selectedApp = await selectPendingOnboardingApp(organization.gid, apikey, appId, pendingApps)

  if (!selectedApp) {
    return {
      appId,
      pendingApp: undefined,
      reusedPendingApp: false,
    }
  }

  const selectedAppId = selectedApp.app_id
  pLog.info(`Using pending onboarding app ${selectedAppId}`)

  if (findNearestCapacitorConfig(cwd())) {
    await syncPendingAppIdToCapacitorConfig(selectedAppId)
  }

  const cleanupSpinner = pSpinner()
  cleanupSpinner.start(`Preparing ${selectedAppId} for real onboarding`)
  try {
    await completePendingOnboardingApp(supabase, organization.gid, selectedAppId)
    cleanupSpinner.stop('Pending onboarding app prepared ✅')
  }
  catch (error) {
    cleanupSpinner.stop('Could not prepare pending onboarding app ❌')
    throw error
  }

  await markStep(organization.gid, apikey, 'add-app', selectedAppId)

  return {
    appId: selectedAppId,
    pendingApp: selectedApp,
    reusedPendingApp: true,
  }
}

async function selectOrganizationForInit(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  roles: string[],
): Promise<Organization> {
  const { error: orgError, data: allOrganizations } = await supabase.rpc('get_orgs_v7')

  if (orgError) {
    pLog.error('Cannot get the list of organizations - exiting')
    pLog.error(`Error ${JSON.stringify(orgError)}`)
    throw new Error('Cannot get the list of organizations')
  }

  const normalizeRole = (role: string | null | undefined) => role?.replace(/^org_/, '') ?? ''
  const normalizedRoles = new Set(roles.map(role => normalizeRole(role)))
  const adminOrgs = allOrganizations.filter(org => normalizedRoles.has(normalizeRole(org.role)))

  if (allOrganizations.length === 0) {
    pLog.error('Could not get organization please create an organization first')
    throw new Error('No organizations available')
  }

  if (adminOrgs.length === 0) {
    pLog.error(`Could not find organization with roles: ${roles.join(' or ')} please create an organization or ask the admin to add you to the organization with this roles`)
    throw new Error('Could not find organization with required roles')
  }

  const organizationUidRaw = adminOrgs.length > 1
    ? await pSelect({
        message: 'Pick the organization that should own this app',
        options: adminOrgs.map((org) => {
          const twoFaWarning = (org.enforcing_2fa && !org['2fa_has_access']) ? '2FA required' : undefined
          return {
            value: org.gid,
            label: org.name,
            hint: twoFaWarning,
          }
        }),
      })
    : adminOrgs[0].gid

  if (pIsCancel(organizationUidRaw)) {
    pOutro('Bye 👋\n💡 You can resume the onboarding anytime by running the same command again')
    exit()
  }

  const organizationUid = organizationUidRaw as string
  const organization = allOrganizations.find(org => org.gid === organizationUid)

  if (!organization) {
    throw new Error('Selected organization not found')
  }

  if (organization.enforcing_2fa && !organization['2fa_has_access']) {
    pLog.error(`The organization "${organization.name}" requires all members to have 2FA enabled.`)
    pLog.error('Enable 2FA at https://web.capgo.app/settings/account and try again.')
    throw new Error('2FA required for selected organization')
  }

  pLog.info(`Using organization "${organization.name}" as the app owner`)
  return organization
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

  while (true) {
    const addChoice = await pSelect({
      message: `Add ${currentAppId} to Capgo?`,
      options: [
        { value: 'yes', label: '✅ Yes, add it' },
        { value: 'change', label: '❌ No, use a different app ID' },
      ],
    })
    await cancelCommand(addChoice, organization.gid, apikey)

    if (addChoice === 'change') {
      currentAppId = await askForAppId('Enter the correct app ID (e.g., com.example.app):')
      await saveAppIdToCapacitorConfig(currentAppId)
      continue
    }

    try {
      const s = pSpinner()
      s.start(`Running: ${pm.runner} @capgo/cli@latest app add ${currentAppId}`)
      try {
        await addAppInternal(currentAppId, options, organization, true)
        s.stop(`App add Done ✅`)
      }
      catch (innerError) {
        s.stop(`App add failed ❌`)
        throw innerError
      }

      pLog.info(`This app is accessible to all members of your organization based on their permissions`)
      await markStep(organization.gid, apikey, 'add-app', currentAppId)
      return currentAppId
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Check if the error is about app already existing
      if (errorMessage.includes('already exist') || errorMessage.includes('duplicate key') || errorMessage.includes('23505')) {
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
        const supabase = await createSupabaseClient(options.apikey ?? apikey, options.supaHost, options.supaAnon)
        const existingResults = await checkAppIdsExist(supabase, rawSuggestions)
        const availableSuggestions = rawSuggestions.filter((_, idx) => !existingResults[idx].exists).slice(0, 4)

        // If no suggestions are available, ask for custom input
        if (availableSuggestions.length === 0) {
          pLog.warn(`No available suggestions found. Please enter a custom app ID.`)
          currentAppId = await askForAppId('Enter your custom app ID (e.g., com.example.myapp):')
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
            await markSnag('onboarding-v2', organization.gid, apikey, 'canceled', undefined, '🤷')
            pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
            exit()
          }

          if (choice === 'cancel') {
            await markSnag('onboarding-v2', organization.gid, apikey, 'canceled-appid-conflict', '🤷')
            pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
            exit()
          }

          if (choice === 'custom') {
            currentAppId = await askForAppId('Enter your custom app ID (e.g., com.example.myapp):')
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
}

async function addChannelStep(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  pLog.info(`💡 Nothing goes to customers before the native app is in the store.`)
  pLog.info(`   This step only affects the test build on your phone.`)
  pLog.info(`   Choose Yes unless you already have your own channel setup.`)
  let channelName = globalChannelName
  const useCustomChannelName = await pConfirm({
    message: `Do you want to choose a custom channel name instead of "${defaultChannel}"?`,
    initialValue: false,
  })
  await cancelCommand(useCustomChannelName, orgId, apikey)

  if (useCustomChannelName) {
    const selectedChannelName = await pText({
      message: 'Enter the channel name to use for onboarding:',
      placeholder: defaultChannel,
      validate: validateChannelName,
    })
    await cancelCommand(selectedChannelName, orgId, apikey)
    channelName = (selectedChannelName as string).trim()
  }

  globalChannelName = channelName
  const doChannel = await pConfirm({ message: `Create channel ${channelName} for ${appId} in Capgo?` })
  await cancelCommand(doChannel, orgId, apikey)
  if (doChannel) {
    const s = pSpinner()
    // create production channel public
    s.start(`Running: ${pm.runner} @capgo/cli@latest channel add ${channelName} ${appId} --default`)
    try {
      const addChannelRes = await addChannelInternal(channelName, appId, {
        default: true,
        apikey,
      }, true)
      if (!addChannelRes)
        s.stop(`Channel already added ✅`)
      else
        s.stop(`Channel add Done ✅`)
    }
    catch (error) {
      s.stop(`Channel creation failed ❌`)
      throw error
    }
  }
  else {
    pLog.info(`If you change your mind, run it for yourself with: "${pm.runner} @capgo/cli@latest channel add ${channelName} ${appId} --default"`)
    pLog.info(`Alternatively, you can:`)
    pLog.info(`  • Set the channel in your capacitor.config.ts file`)
    pLog.info(`  • Use the JavaScript setChannel() method to dynamically set the channel`)
    pLog.info(`  • Configure channels later from the Capgo web console`)
  }
  await markStep(orgId, apikey, 'add-channel', appId)
  return channelName
}

async function getAssistedDependencies(stepsDone: number) {
  // here we will assume that getAllPackagesDependencies uses 'findRoot(cwd())' for the first argument
  const root = join(findRoot(cwd()), PACKNAME)
  const packageJsonPath = globalPathToPackageJson ?? root
  const dependencies = await getAllPackagesDependencies(undefined, packageJsonPath)
  if (dependencies.size === 0 || !dependencies.has('@capacitor/core')) {
    pLog.warn('No adequate dependencies found')
    const doSelect = await pConfirm({ message: 'Would you like to select the package.json file manually?' })
    if (pIsCancel(doSelect)) {
      pCancel('Operation cancelled.')
      exit(1)
    }
    if (doSelect) {
      const useNativePicker = canUseFilePicker()
      if (useNativePicker) {
        const selectedPath = await openPackageJsonPicker()
        if (selectedPath) {
          if (path.basename(selectedPath) !== PACKNAME) {
            pLog.error('Selected a file that is not a package.json file')
          }
          else if (!existsSync(selectedPath)) {
            pLog.error(`Path ${selectedPath} does not exist`)
          }
          else {
            markStepDone(stepsDone, selectedPath)
            return { dependencies: await getAllPackagesDependencies(undefined, selectedPath), path: selectedPath }
          }
        }

        pLog.info('Falling back to manual path entry.')
      }

      if (!useNativePicker) {
        const useTreeSelect = await pConfirm({ message: 'Would you like to use a tree selector to choose the package.json file?' })
        if (pIsCancel(useTreeSelect)) {
          pCancel('Operation cancelled.')
          exit(1)
        }

        if (useTreeSelect) {
          let currentPath = cwd()
          let selectedEntry = PACKNAME as string | symbol
          while (true) {
            const options = readdirSync(currentPath)
              .map(dir => ({ value: dir, label: dir }))
            options.push({ value: '..', label: '..' })
            selectedEntry = await pSelect({
              message: 'Select package.json file:',
              options,
            })
            if (pIsCancel(selectedEntry)) {
              pCancel('Operation cancelled.')
              exit(1)
            }
            if (!statSync(join(currentPath, selectedEntry)).isDirectory() && selectedEntry !== PACKNAME) {
              pLog.error(`Selected a file that is not a package.json file`)
              continue
            }
            currentPath = join(currentPath, selectedEntry)
            if (selectedEntry === PACKNAME) {
              break
            }
          }
          markStepDone(stepsDone, currentPath)
          return { dependencies: await getAllPackagesDependencies(undefined, currentPath), path: currentPath }
        }
      }

      const packageJsonPath = await pText({
        message: 'Enter path to package.json file:',
        validate: (value) => {
          if (!value?.trim())
            return 'Path is required.'
          if (!existsSync(value))
            return `Path ${value} does not exist`
          if (path.basename(value) !== PACKNAME)
            return 'Selected a file that is not a package.json file'
        },
      }) as string
      if (pIsCancel(packageJsonPath)) {
        pCancel('Operation cancelled.')
        exit(1)
      }
      const selectedPackageJsonPath = packageJsonPath.trim()
      markStepDone(stepsDone, selectedPackageJsonPath)
      return { dependencies: await getAllPackagesDependencies(undefined, selectedPackageJsonPath), path: selectedPackageJsonPath }
    }
  }

  // even in the default case, let's mark the path to package.json
  // this will help with bundle upload
  markStepDone(stepsDone, root)
  return { dependencies: await getAllPackagesDependencies(undefined, root), path: root }
}

const urlMigrateV5 = 'https://capacitorjs.com/docs/updating/5-0'
const urlMigrateV6 = 'https://capacitorjs.com/docs/updating/6-0'
const urlMigrateV7 = 'https://capacitorjs.com/docs/updating/7-0'
const urlMigrateV8 = 'https://capacitorjs.com/docs/updating/8-0'

function getUpdaterInstallBlocker(dependencies: Map<string, string>, packageManager: ReturnType<typeof getPMAndCommand>): string | undefined {
  if (!dependencies.has('@capacitor/core'))
    return 'Cannot find @capacitor/core in package.json.'

  const coreVersion = dependencies.get('@capacitor/core')
  if (!coreVersion)
    return 'Cannot determine the installed @capacitor/core version.'
  const normalizedCoreVersion = normalizeConcreteVersion(coreVersion)
  if (!normalizedCoreVersion)
    return `Cannot parse @capacitor/core version "${coreVersion}". Pin a concrete semver version before continuing.`
  if (lessThan(parse(normalizedCoreVersion), parse('5.0.0')))
    return `@capacitor/core version is ${normalizedCoreVersion}. Capgo requires Capacitor v5 or newer. Migration guide: ${urlMigrateV5}`
  if (packageManager.pm === 'unknown')
    return 'Cannot recognize the package manager for this project. Use bun, pnpm, yarn, or npm in a Capacitor project root.'

  return undefined
}

async function addUpdaterStep(orgId: string, apikey: string, appId: string) {
  const pm = getPMAndCommand()
  let pkgVersion = '1.0.0'
  let delta = false
  const doInstall = await pConfirm({ message: `Automatic Install "@capgo/capacitor-updater" dependency in ${appId}?` })
  await cancelCommand(doInstall, orgId, apikey)
  if (doInstall) {
    while (true) {
      const s = pSpinner()
      let versionToInstall = 'latest'
      let shouldOfferDirectInstall = false
      // 3 because this is the 4th step, ergo 3 steps have already been done
      const { dependencies, path } = await getAssistedDependencies(3)
      s.start(`Checking if @capgo/capacitor-updater is installed`)

      const blocker = getUpdaterInstallBlocker(dependencies, pm)
      if (blocker) {
        s.stop('Updater install blocked ❌')
        pLog.warn(blocker)
        await selectRecoveryOption(orgId, apikey, 'Fix the project, then choose what to do next.', [
          { value: 'retry', label: 'Retry updater checks' },
        ])
        continue
      }

      const coreVersion = normalizeConcreteVersion(dependencies.get('@capacitor/core'))!
      if (lessThan(parse(coreVersion), parse('6.0.0'))) {
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
        pLog.info(`@capacitor/core version is ${coreVersion}, installing latest capacitor-updater`)
        versionToInstall = 'latest'
        shouldOfferDirectInstall = true
      }

      try {
        const installedVersion = await getInstalledVersion('@capgo/capacitor-updater', dirname(path), path)
        pkgVersion = getBundleVersion(undefined, path) || pkgVersion
        if (installedVersion) {
          s.stop(`Capgo already installed ✅`)
        }
        else {
          await execSync(`${pm.installCommand} --force @capgo/capacitor-updater@${versionToInstall}`, { ...execOption, cwd: dirname(path) } as ExecSyncOptions)
          s.stop(`Install Done ✅`)
          let doDirectInstall: boolean | symbol = false
          if (shouldOfferDirectInstall) {
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

        break
      }
      catch (error) {
        s.stop('Updater install failed ❌')
        pLog.error(formatError(error))
        await selectRecoveryOption(orgId, apikey, 'Updater install failed. What do you want to do?', [
          { value: 'retry', label: 'Retry updater install' },
        ])
      }
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
        mainFilePath = findMainFileForProjectType(projectType, isTypeScript)
      }

      // Open main file and inject codeInject
      if (!mainFilePath || !existsSync(mainFilePath)) {
        s.stop('Cannot find main file to install Updater plugin', 'neutral')
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
        s.stop('Cannot auto-inject code', 'neutral')
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
  const normalizedCoreVersion = normalizeConcreteVersion(coreVersion)
  if (!coreVersion) {
    pLog.warn(`Cannot find @capacitor/core in package.json. It is likely that you are using a monorepo. Please NOTE that encryption is not supported in Capacitor V5.`)
  }

  const pm = getPMAndCommand()

  pLog.info(`🔐 End-to-end encryption`)
  const isSecurityCritical = await pConfirm({
    message: `Is ${appId} a security-critical app, like banking, regulated, or sensitive-data handling?`,
    initialValue: false,
  })
  await cancelCommand(isSecurityCritical, orgId, apikey)
  if (isSecurityCritical) {
    pLog.info(`   Capgo bundles are web assets, so JS, HTML, and CSS can be fetched if someone finds the URL.`)
    pLog.info(`   That is why we recommend encryption for banking and other high-security apps.`)
    pLog.info(`   🔑 Do not put private API keys or backend secrets in a mobile app.`)

    const doEncrypt = await pConfirm({
      message: `Do you want to use encryption for ${appId}?`,
      initialValue: true,
    })
    await cancelCommand(doEncrypt, orgId, apikey)
    if (doEncrypt) {
      pLog.info(`   ✅ Recommended: encrypted bundles stay unreadable when fetched without the key.`)
      pLog.info(`   ⚠️  Debugging gets harder, so skip it for normal apps.`)
      pLog.info(`   🔐 The private key stays on your machine and must not be committed.`)
      pLog.info(`   🔓 The public key is saved in the app bundle, so it can be extracted by reverse engineering.`)
      pLog.info(`   🔄 The JavaScript bundle is encrypted with a random AES session key before upload.`)
      pLog.info(`   🔒 That AES key is stored in Capgo, encrypted with your private RSA key, and the app uses the public RSA key to decrypt it.`)
      pLog.info(`   ✍️  The bundle checksum is signed with your RSA key, so the app can verify the bundle was not tampered with.`)
      if (coreVersion && !normalizedCoreVersion) {
        pLog.error(`Cannot parse @capacitor/core version "${coreVersion}". Pin a concrete semver version before enabling encryption.`)
        return
      }
      if (normalizedCoreVersion && lessThan(parse(normalizedCoreVersion), parse('6.0.0'))) {
        pLog.warn(`Encryption is not supported in Capacitor V5.`)
        return
      }

      const s = pSpinner()
      s.start(`Running: ${pm.runner} @capgo/cli@latest key create`)
      const keyRes = await createKeyInternal({ force: true }, false)
      if (keyRes) {
        s.stop(`key created 🔑`)
        await markSnag('onboarding-v2', orgId, apikey, 'Use encryption v2', appId)
      }
      else {
        s.stop('Error', 'error')
        pLog.warn(`Cannot create key ❌`)
        const recoveryChoice = await selectRecoveryOption(orgId, apikey, 'Encryption key creation failed. What do you want to do?', [
          { value: 'retry', label: 'Retry key creation' },
          { value: 'skip', label: 'Continue without encryption' },
        ])

        if (recoveryChoice === 'retry') {
          return addEncryptionStep(orgId, apikey, appId)
        }

        pLog.info(`⏭️  Continuing without encryption.`)
      }
    }
    else {
      pLog.info(`⏭️  We didn't enable encryption.`)
    }
  }
  else {
    pLog.info(`⏭️  We didn't enable encryption.`)
    pLog.info(`   📦 Capgo bundles are web assets and can be fetched by anyone who finds the URL.`)
    pLog.info(`   🔑 Do not put private API keys or backend secrets in a mobile app.`)
  }
  await markStep(orgId, apikey, 'add-encryption', appId)
}

async function buildProjectStep(orgId: string, apikey: string, appId: string, platform: 'ios' | 'android') {
  const pm = getPMAndCommand()
  const doBuild = await pConfirm({ message: `Automatic build ${appId} with "${pm.pm} run build" ?` })
  await cancelCommand(doBuild, orgId, apikey)
  if (doBuild) {
    const projectType = await findProjectType()
    const buildCommand = await findBuildCommandForProjectType(projectType)
    const packScripts = getPackageScripts()
    // check in script build exist
    if (!packScripts[buildCommand]) {
      const s = pSpinner()
      s.start(`Checking project type`)
      s.stop('Missing build script', 'neutral')
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

    const buildAndSyncCommand = `${pm.pm} run ${buildCommand} && ${pm.runner} cap sync ${platform}`
    let iosSyncFailureCount = 0

    while (true) {
      const s = pSpinner()
      s.start('Checking project type')
      s.message(`Running: ${buildAndSyncCommand}`)
      execSync(buildAndSyncCommand, execOption as ExecSyncOptions)

      if (platform === 'ios') {
        const syncValidation = validateIosUpdaterSync(cwd(), globalPathToPackageJson)
        if (syncValidation.shouldCheck && !syncValidation.valid) {
          iosSyncFailureCount += 1
          s.stop('iOS sync check failed ❌')
          await handleBrokenIosSync(pm.runner, syncValidation.details, orgId, apikey, iosSyncFailureCount)
          pLog.info(`Retrying build and sync for iOS (attempt ${iosSyncFailureCount + 1})`)
          continue
        }
      }

      s.stop('Build & Sync Done ✅')
      break
    }
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
    await markSnag('onboarding-v2', orgId, apikey, 'canceled', undefined, '🤷')
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

async function addCodeChangeStep(orgId: string, apikey: string, appId: string, pkgVersion: string, platform: 'ios' | 'android') {
  pLog.info(`🎯 Now let's test Capgo by making a visible change and deploying an update!`)

  const modificationType = await pSelect({
    message: 'How would you like to test the update?',
    options: [
      { value: 'auto', label: 'Auto: Let Capgo CLI make a visible change for you' },
      { value: 'manual', label: 'Manual: I\'ll make changes myself' },
    ],
  })
  if (pIsCancel(modificationType)) {
    await markSnag('onboarding-v2', orgId, apikey, 'canceled', undefined, '🤷')
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
      s.stop('⚠️  Could not automatically modify files', 'neutral')
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
    await markSnag('onboarding-v2', orgId, apikey, 'canceled', undefined, '🤷')
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
      await markSnag('onboarding-v2', orgId, apikey, 'canceled', undefined, '🤷')
      pOutro(`Bye 👋\n💡 You can resume the onboarding anytime by running the same command again`)
      exit()
    }
    newVersion = userVersion as string
  }
  pLog.info(`🧭 This OTA upload will use version ${newVersion}. For the next test, increment it again.`)

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
      s.stop('Missing build script', 'neutral')
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
    let nodeModulesPath: string | undefined
    const isMonorepo = projectIsMonorepo(cwd())
    while (true) {
      const s = pSpinner()
      s.start(`Running: ${pm.runner} @capgo/cli@latest bundle upload ${delta ? '--delta-only' : ''}`)
      if (globalPathToPackageJson && isMonorepo) {
        pLog.warn(`You are most likely using a monorepo, please provide the path to your package.json file AND node_modules path folder when uploading your bundle`)
        pLog.warn(`Example: ${pm.runner} @capgo/cli@latest bundle upload --package-json ./packages/my-app/package.json --node-modules ./packages/my-app/node_modules ${delta ? '--delta-only' : ''}`)
        nodeModulesPath ||= join(findRoot(cwd()), 'node_modules')
        pLog.warn(`Using node modules path: ${nodeModulesPath}`)
        if (!existsSync(nodeModulesPath)) {
          s.stop('Upload blocked ❌')
          pLog.error(`Node modules path does not exist`)
          nodeModulesPath = await askForExistingDirectoryPath(orgId, apikey, 'Enter the path to the correct node_modules directory:', nodeModulesPath)
          continue
        }
      }

      let uploadRes: Awaited<ReturnType<typeof uploadBundleInternal>> | undefined
      try {
        uploadRes = await uploadBundleInternal(appId, {
          channel: globalChannelName,
          apikey,
          packageJson: isMonorepo ? globalPathToPackageJson : undefined,
          nodeModules: isMonorepo ? nodeModulesPath : undefined,
          deltaOnly: delta,
          bundle: newVersion,
          ignoreChecksumCheck: true,
          // Onboarding owns replication UX after the upload spinner stops.
          showReplicationProgress: false,
        }, false)
      }
      catch (error) {
        s.stop('Upload failed ❌')
        pLog.error(formatError(error))
        await selectRecoveryOption(orgId, apikey, 'Bundle upload failed. What do you want to do?', [
          { value: 'retry', label: 'Retry bundle upload' },
        ])
        continue
      }
      if (!uploadRes?.success) {
        s.stop('Upload failed ❌')
        await selectRecoveryOption(orgId, apikey, 'Bundle upload failed. What do you want to do?', [
          { value: 'retry', label: 'Retry bundle upload' },
        ])
        continue
      }

      s.stop(`✅ Update v${newVersion} uploaded successfully!`)
      await showReplicationProgress({
        title: 'Replicating your updated bundle in onboarding regions.',
        completeMessage: 'Update replication is now fully propagated.',
        interactive: !!stdin.isTTY && !!stdout.isTTY,
      })
      pLog.info(`🎉 Your updated bundle is now available on Capgo`)
      break
    }
  }
  else {
    const manualUploadCommandParts = [
      `${pm.runner} @capgo/cli@latest bundle upload ${appId}`,
      `--bundle ${newVersion}`,
      `--channel ${globalChannelName}`,
      delta ? '--delta-only' : '',
      globalPathToPackageJson ? `--package-json ${globalPathToPackageJson}` : '',
    ]
    const manualUploadCommand = manualUploadCommandParts.filter(Boolean).join(' ')
    pLog.info(`Upload yourself with command: ${manualUploadCommand}`)
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
    pLog.info(`📊 Check logs manually at ${hostWeb}/app/${appId}/logs to verify the update`)
  }
  await markStep(orgId, apikey, 'test-update', appId)
}

const capgoSkillsRepository = 'https://github.com/Cap-go/capgo-skills'
const capgoSkillsStarRepository = 'Cap-go/capgo-skills'

function formatGithubRepositoryList(repositories: string[]) {
  if (repositories.length === 0)
    return ''
  if (repositories.length === 1)
    return repositories[0]
  if (repositories.length === 2)
    return `${repositories[0]} and ${repositories[1]}`

  return `${repositories.slice(0, -1).join(', ')}, and ${repositories[repositories.length - 1]}`
}

async function maybeInstallCapgoSkills() {
  if (!stdin.isTTY || !stdout.isTTY)
    return false

  const pm = getPMAndCommand()
  const installCommand = `${pm.runner} skills add ${capgoSkillsRepository} -g -y`
  const shouldInstall = await pConfirm({
    message: 'Install Capgo capacitor skills (capgo-skills) for your coding agent?',
    initialValue: true,
  })

  if (pIsCancel(shouldInstall) || !shouldInstall)
    return false

  pLog.info(`Running command: ${installCommand}`)

  const spinner = pSpinner()
  spinner.start(`Running: ${installCommand}`)

  try {
    const result = spawnSync(pm.runner, ['skills', 'add', capgoSkillsRepository, '-g', '-y'], {
      stdio: 'pipe',
      encoding: 'utf8',
    })

    if (result.status === 0) {
      spinner.stop('Capgo skills install Done ✅')
      return true
    }

    spinner.stop('Capgo skills install failed ❌')
    const commandError = [result.stderr, result.stdout]
      .find(value => typeof value === 'string' && value.trim().length > 0)
      ?.trim()
    pLog.warn(`Could not install Capgo skills automatically: ${commandError || 'Unknown error'}`)
    pLog.info(`Run it yourself with: "${installCommand}"`)
    return true
  }
  catch (error) {
    spinner.stop('Capgo skills install failed ❌')
    pLog.warn(`Could not install Capgo skills automatically: ${formatError(error)}`)
    pLog.info(`Run it yourself with: "${installCommand}"`)
    return true
  }
}

async function maybeStarCapgoRepo(includeSkillsRepository = false, repository?: string) {
  if (!stdin.isTTY || !stdout.isTTY)
    return

  const status = getRepoStarStatus(repository)
  if (!status.ghInstalled || !status.ghLoggedIn)
    return

  const directRepositories = [status.repository]
  if (includeSkillsRepository)
    directRepositories.push(capgoSkillsStarRepository)

  const availableDirectRepositories = directRepositories.filter((repo) => {
    const repoStatus = getRepoStarStatus(repo)
    return repoStatus.repositoryExists && !repoStatus.starred && !isRepoStarredInSession(repoStatus.repository)
  })

  if (availableDirectRepositories.length === 0 && (!status.repositoryExists || status.starred || isRepoStarredInSession(status.repository)))
    return

  const directLabel = availableDirectRepositories.length > 0
    ? `Star ${formatGithubRepositoryList(availableDirectRepositories)}`
    : `Star ${status.repository}`
  const allLabel = includeSkillsRepository
    ? 'Star all Capgo repos and Cap-go/capgo-skills'
    : 'Star all Capgo repos (repositories starting with capacitor- in Cap-go org)'

  const starChoice = await pSelect({
    message: `How would you like to support Capgo on GitHub?`,
    options: [
      { value: 'star-update', label: directLabel },
      { value: 'star-all', label: allLabel },
      { value: 'skip', label: 'No, thanks' },
    ],
  })

  if (pIsCancel(starChoice) || starChoice === 'skip') {
    return
  }

  try {
    if (starChoice === 'star-update') {
      for (const repositoryToStar of availableDirectRepositories) {
        const result = starRepository(repositoryToStar)
        if (result.alreadyStarred) {
          pLog.info(`🫶 ${result.repository} is already starred`)
        }
        else {
          pLog.success(`🙏 Thanks for starring ${result.repository} 🎉`)
        }
      }
    }
    else if (starChoice === 'star-all') {
      const result = await starAllRepositories()

      for (const repository of result) {
        if (repository.error) {
          pLog.error(`⚠️ Could not star ${repository.repository}: ${repository.error}`)
        }
        else if (repository.alreadyStarred) {
          pLog.info(`🫶 ${repository.repository} is already starred`)
        }
        else {
          pLog.success(`🙏 Thanks for starring ${repository.repository} 🎉`)
        }
      }

      if (includeSkillsRepository) {
        const skillsResult = starRepository(capgoSkillsStarRepository)
        if (skillsResult.alreadyStarred) {
          pLog.info(`🫶 ${skillsResult.repository} is already starred`)
        }
        else {
          pLog.success(`🙏 Thanks for starring ${skillsResult.repository} 🎉`)
        }
      }
    }
  }
  catch (error) {
    pLog.warn(`Cannot star ${status.repository} right now: ${formatError(error)}`)
  }
}

export async function initApp(apikeyCommand: string, appId: string, options: SuperOptions) {
  const pm = getPMAndCommand()
  pIntro('Capgo onboarding')
  renderInitOnboardingWelcome(initOnboardingSteps.length)
  appId = await ensureWorkspaceReadyForInit(appId) ?? appId
  const versionStatus = await checkVersionStatus()
  if (versionStatus.isOutdated) {
    setInitVersionWarning(versionStatus.currentVersion, versionStatus.latestVersion, versionStatus.majorVersion)
  }

  let extConfig: Awaited<ReturnType<typeof getConfig>> | undefined
  if (!options.supaAnon || !options.supaHost) {
    try {
      extConfig = await getConfig()
    }
    catch {
      extConfig = undefined
    }
  }
  else {
    extConfig = await updateConfigUpdater({
      statsUrl: `${options.supaHost}/functions/v1/stats`,
      channelUrl: `${options.supaHost}/functions/v1/channel_self`,
      updateUrl: `${options.supaHost}/functions/v1/updates`,
      localApiFiles: `${options.supaHost}/functions/v1`,
      localS3: true,
      localSupa: options.supaHost,
      localSupaAnon: options.supaAnon,
    })
  }
  const localConfig = await getLocalConfig()
  appId = getAppId(appId, extConfig?.config)
  options.apikey = apikeyCommand
  if (!options.apikey) {
    try {
      options.apikey ??= findSavedKey(true)
    }
    catch {
    }
  }

  appId ??= await askForAppId('Enter your appId:')

  const log = pSpinner()
  if (!doLoginExists() || apikeyCommand) {
    log.start(`Running: ${pm.runner} @capgo/cli@latest login ***`)
    try {
      await loginInternal(options.apikey, options, true)
      log.stop('Login Done ✅')
    }
    catch (error) {
      log.stop('Login failed ❌')
      throw error
    }
  }

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
  await verifyUser(supabase, options.apikey, ['upload', 'all', 'read', 'write'])

  const organization = await selectOrganizationForInit(supabase, ['admin', 'super_admin'])
  const orgId = organization.gid
  const pendingOnboardingSelection = await maybeReusePendingOnboardingApp(organization, options.apikey, appId, supabase)
  appId = pendingOnboardingSelection.appId ?? appId
  await ensureCapacitorProjectReady(orgId, options.apikey, appId, pendingOnboardingSelection.pendingApp)

  let stepToSkip = await readStepsDone(orgId, options.apikey) ?? 0
  if (pendingOnboardingSelection.reusedPendingApp) {
    stepToSkip = Math.max(stepToSkip, 1)
  }
  let pkgVersion = getBundleVersion(undefined, globalPathToPackageJson) || '1.0.0'
  let delta = globalDelta
  let currentVersion = globalCurrentVersion || pkgVersion
  let channelName = globalChannelName
  let platform: 'ios' | 'android' = globalPlatform

  if (globalCurrentVersion && stepToSkip >= 3) {
    pkgVersion = globalCurrentVersion
  }

  const totalSteps = initOnboardingSteps.length
  let showResumeBanner = stepToSkip > 0

  const renderCurrentStep = (stepNumber: number) => {
    renderInitOnboardingFrame(stepNumber, totalSteps, { resumed: showResumeBanner })
    showResumeBanner = false
  }

  try {
    if (stepToSkip < 1) {
      renderCurrentStep(1)
      await checkPrerequisitesStep(orgId, options.apikey)
      appId = await addAppStep(organization, options.apikey, appId, options)
      markStepDone(1)
    }

    if (stepToSkip < 2) {
      renderCurrentStep(2)
      channelName = await addChannelStep(orgId, options.apikey, appId)
      globalChannelName = channelName
      markStepDone(2, undefined, channelName)
    }

    if (stepToSkip < 3) {
      renderCurrentStep(3)
      const res = await addUpdaterStep(orgId, options.apikey, appId)
      pkgVersion = res.pkgVersion
      currentVersion = pkgVersion
      delta = res.delta
      globalCurrentVersion = currentVersion
      globalDelta = delta
      markStepDone(3)
    }

    if (stepToSkip < 4) {
      renderCurrentStep(4)
      await addCodeStep(orgId, options.apikey, appId)
      markStepDone(4)
    }

    if (stepToSkip < 5) {
      renderCurrentStep(5)
      await addEncryptionStep(orgId, options.apikey, appId)
      markStepDone(5)
    }

    if (stepToSkip < 6) {
      renderCurrentStep(6)
      platform = await selectPlatformStep(orgId, options.apikey)
      globalPlatform = platform
      markStepDone(6)
    }

    if (stepToSkip < 7) {
      renderCurrentStep(7)
      await buildProjectStep(orgId, options.apikey, appId, platform)
      markStepDone(7)
    }

    if (stepToSkip < 8) {
      renderCurrentStep(8)
      await runDeviceStep(orgId, options.apikey, appId, platform)
      markStepDone(8)
    }

    if (stepToSkip < 9) {
      renderCurrentStep(9)
      currentVersion = await addCodeChangeStep(orgId, options.apikey, appId, pkgVersion, platform)
      globalCurrentVersion = currentVersion
      markStepDone(9)
    }

    if (stepToSkip < 10) {
      renderCurrentStep(10)
      await uploadStep(orgId, options.apikey, appId, currentVersion, delta)
      markStepDone(10)
    }

    if (stepToSkip < 11) {
      renderCurrentStep(11)
      await testCapgoUpdateStep(orgId, options.apikey, appId, localConfig.hostWeb, delta)
      markStepDone(11)
    }

    if (stepToSkip < 12) {
      renderCurrentStep(12)
      markStepDone(12)
    }

    await markStep(orgId, options.apikey, 'done', appId)
    cleanupStepsDone()
  }
  catch (e) {
    pLog.error(`Error during onboarding: ${formatError(e)}`)
    pLog.error(`Error during onboarding.\n if the error persists please contact support@capgo.app\n Or use manual installation: https://capgo.app/docs/getting-started/add-an-app/`)
    exit(1)
  }

  renderInitOnboardingComplete(
    appId,
    `${pm.runner} @capgo/cli@latest bundle upload --bundle <new-version> --channel ${globalChannelName}`,
    `${pm.runner} @capgo/cli@latest app debug`,
  )
  pLog.info(`If you want to run another full OTA self-test after onboarding:`)
  pLog.info(`1. Make a visible change`)
  pLog.info(`2. Build web assets only: ${pm.pm} run build`)
  pLog.info(`3. Upload with a new version: ${pm.runner} @capgo/cli@latest bundle upload --bundle <new-version> --channel ${globalChannelName}`)
  pLog.warn(`Do not run "${pm.runner} cap sync" before validating the OTA update.`)
  pLog.warn('Reason: cap sync puts your local build directly in the native app, which bypasses the Capgo OTA path.')
  pLog.info(`If you have any issue try to use the debug command \`${pm.runner} @capgo/cli@latest app debug\``)
  const didChooseSkills = await maybeInstallCapgoSkills()
  await maybeStarCapgoRepo(didChooseSkills)
  pOutro(`Bye 👋`)
  exit()
}
