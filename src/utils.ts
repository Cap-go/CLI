import type { InstallCommand, PackageManagerRunner, PackageManagerType } from '@capgo/find-package-manager'
import type {
  SemVer,
} from '@std/semver'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Buffer } from 'node:buffer'
import type { CapacitorConfig, ExtConfigPairs } from './config'
import type { Database } from './types/supabase.types'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, platform as osPlatform } from 'node:os'
import path, { dirname, join, relative, resolve, sep } from 'node:path'
import { cwd, env } from 'node:process'
import { findMonorepoRoot, findNXMonorepoRoot, isMonorepo, isNXMonorepo } from '@capacitor/cli/dist/util/monorepotools'
import { findInstallCommand, findPackageManagerRunner, findPackageManagerType } from '@capgo/find-package-manager'
import { confirm as confirmC, isCancel, log, select, spinner as spinnerC } from '@clack/prompts'
import { canParse, format, lessThan, parse, parseRange, rangeIntersects } from '@std/semver'
import { createClient, FunctionsHttpError } from '@supabase/supabase-js'
import AdmZip from 'adm-zip'
// Native fetch is available in Node.js >= 18
import prettyjson from 'prettyjson'
import * as tus from 'tus-js-client'
import { markSnag } from './app/debug'
import { getChecksum } from './checksum'
import { loadConfig, writeConfig } from './config'

export const baseKey = '.capgo_key'
export const baseKeyV2 = '.capgo_key_v2'
export const baseKeyPub = `${baseKey}.pub`
export const baseKeyPubV2 = `${baseKeyV2}.pub`
export const defaultHost = 'https://capgo.app'
export const defaultFileHost = 'https://files.capgo.app'
export const defaultApiHost = 'https://api.capgo.app'
export const defaultHostWeb = 'https://console.capgo.app'
export const UPLOAD_TIMEOUT = 120000
export const ALERT_UPLOAD_SIZE_BYTES = 1024 * 1024 * 20 // 20MB
export const MAX_UPLOAD_LENGTH_BYTES = 1024 * 1024 * 1024 // 1GB
export const MAX_CHUNK_SIZE_BYTES = 1024 * 1024 * 99 // 99MB

export const PACKNAME = 'package.json'

export type ArrayElement<ArrayType extends readonly unknown[]>
  = ArrayType extends readonly (infer ElementType)[] ? ElementType : never
export type Organization = ArrayElement<Database['public']['Functions']['get_orgs_v6']['Returns']>

export const regexSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*))*))?(?:\+([0-9a-z-]+(?:\.[0-9a-z-]+)*))?$/i
export const formatError = (error: any) => error ? `\n${prettyjson.render(error)}` : ''

type TagKey = Lowercase<string>
/** Tag Type */
type Tags = Record<TagKey, string | number | boolean>
type Parser = 'markdown' | 'text'
/**
 * Options for publishing LogSnag events
 */
interface TrackOptions {
  /**
   * Channel name
   * example: "waitlist"
   */
  channel: string
  /**
   * Event name
   * example: "User Joined"
   */
  event: string
  /**
   * Event description
   * example: "joe@example.com joined waitlist"
   */
  description?: string
  /**
   * User ID
   * example: "user-123"
   */
  user_id?: string
  /**
   * Event icon (emoji)
   * must be a single emoji
   * example: "🎉"
   */
  icon?: string
  /**
   * Event tags
   * example: { username: "mattie" }
   */
  tags?: Tags
  /**
   * Send push notification
   */
  notify?: boolean
  /**
   * Parser for description
   */
  parser?: Parser
  /**
   * Event timestamp
   */
  timestamp?: number | Date
}

export interface OptionsBase {
  apikey: string
  supaHost?: string
  supaAnon?: string
}

export function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function projectIsMonorepo(dir: string) {
  return isMonorepo(dir) || isNXMonorepo(dir)
}

export function findRoot(dir: string) {
  if (isMonorepo(dir)) {
    return findMonorepoRoot(dir)
  }
  else if (isNXMonorepo(dir)) {
    return findNXMonorepoRoot(dir)
  }
  return dir
}

// do not expose this function this prevent missuses
function readPackageJson(f: string = findRoot(cwd()), file: string | undefined = undefined) {
  const fileSplit = file?.split(',')[0]
  if (fileSplit) {
    if (!existsSync(fileSplit)) {
      const message = `Package.json at ${fileSplit} does not exist`
      log.error(message)
      throw new Error(message)
    }
  }
  const packageJson = readFileSync(fileSplit ?? join(f, PACKNAME))
  return JSON.parse(packageJson as any)
}

export function getPackageScripts(f: string = findRoot(cwd()), file: string | undefined = undefined): Record<string, string> {
  const packageJson = readPackageJson(f, file)
  return packageJson.scripts
}
export function getBundleVersion(f: string = findRoot(cwd()), file: string | undefined = undefined): string {
  const packageJson = readPackageJson(f, file)
  return packageJson.version ?? ''
}

function returnVersion(version: string) {
  const tmpVersion = version.replace('^', '').replace('~', '')
  if (canParse(tmpVersion)) {
    try {
      const parsed = parse(tmpVersion)
      return format(parsed)
    }
    catch {
      return tmpVersion
    }
  }
  return tmpVersion
}

/**
 * Get the actual installed version of a package from node_modules (not from package.json)
 * Uses multiple resolution strategies to find the installed version:
 * 1. require.resolve - Works with all package managers
 * 2. Walk up node_modules - Handles hoisted dependencies in monorepos
 * 3. Native config files (iOS/Android) - For @capgo/capacitor-updater only
 * 4. Fallback to declared version in package.json
 *
 * @param packageName - The package name to check
 * @param rootDir - The root directory of the project
 * @param packageJsonPath - Optional custom package.json path provided by user (takes priority if provided)
 */
export async function getInstalledVersion(packageName: string, rootDir: string = cwd(), packageJsonPath?: string): Promise<string | null> {
  // Determine the base directory for resolution
  // If packageJsonPath is provided, use its directory as the starting point
  const baseDir = packageJsonPath ? dirname(packageJsonPath) : rootDir

  // Priority 1: Use require.resolve to find the actual installed package
  // This works with all package managers (npm, yarn, pnpm, bun) and monorepos
  try {
    const packageJsonFile = `${packageName}/package.json`
    // Create require from baseDir context to resolve from the right location
    const { createRequire } = await import('node:module')
    const requireFromBase = createRequire(join(baseDir, 'package.json'))
    const resolvedPath = requireFromBase.resolve(packageJsonFile)
    const pkg = JSON.parse(readFileSync(resolvedPath, 'utf-8'))
    if (pkg.version)
      return pkg.version
  }
  catch {
    // require.resolve failed, try other methods
  }

  // Priority 2: Walk up directories looking for node_modules (handles monorepos with hoisting)
  let currentDir = baseDir
  const root = path.parse(currentDir).root
  while (currentDir !== root) {
    const nodeModulesPath = join(currentDir, 'node_modules', packageName, PACKNAME)
    if (existsSync(nodeModulesPath)) {
      try {
        const pkg = JSON.parse(readFileSync(nodeModulesPath, 'utf-8'))
        if (pkg.version)
          return pkg.version
      }
      catch {
        // Continue walking up
      }
    }
    const parentDir = dirname(currentDir)
    if (parentDir === currentDir)
      break
    currentDir = parentDir
  }

  // Priority 3: Check native config files (iOS Podfile or Android gradle) - only for @capgo/capacitor-updater
  if (packageName === '@capgo/capacitor-updater') {
    let packagePath: string | null = null

    // Try iOS Podfile
    const podfilePath = join(rootDir, 'ios', 'App', 'Podfile')
    if (existsSync(podfilePath)) {
      try {
        const podfileContent = readFileSync(podfilePath, 'utf-8')
        // Look for: pod 'CapgoCapacitorUpdater', :path => '../../node_modules/@capgo/capacitor-updater'
        const match = podfileContent.match(/pod\s+['"]CapgoCapacitorUpdater['"],\s*:path\s*=>\s*['"]([^'"]+)['"]/)
        if (match?.[1]) {
          // Resolve relative path from ios/App directory
          packagePath = resolve(join(rootDir, 'ios', 'App', match[1]))
        }
      }
      catch {
        // Continue to try Android
      }
    }

    // Try Android capacitor.settings.gradle if iOS didn't work
    if (!packagePath) {
      const gradlePath = join(rootDir, 'android', 'capacitor.settings.gradle')
      if (existsSync(gradlePath)) {
        try {
          const gradleContent = readFileSync(gradlePath, 'utf-8')
          // Look for: project(':capgo-capacitor-updater').projectDir = new File('../node_modules/@capgo/capacitor-updater/android')
          const match = gradleContent.match(/project\(':capgo-capacitor-updater'\)\.projectDir\s*=\s*new\s+File\(['"]([^'"]+)['"]/)
          if (match?.[1]) {
            // Resolve relative path from android directory, remove /android suffix
            const fullPath = resolve(join(rootDir, 'android', match[1]))
            packagePath = fullPath.replace(/\/android$/, '')
          }
        }
        catch {
          // Both failed
        }
      }
    }

    // Read package.json from the resolved path
    if (packagePath) {
      const pkgJsonPath = join(packagePath, PACKNAME)
      if (existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
          if (pkg.version)
            return pkg.version
        }
        catch {
          // Fall through to final fallback
        }
      }
    }
  }

  // Priority 5: Final fallback - use default package.json location (declared version)
  try {
    const dependencies = await getAllPackagesDependencies(rootDir)
    const version = dependencies.get(packageName)
    if (version)
      return version
  }
  catch {
    // All methods failed
  }

  return null
}

export async function getAllPackagesDependencies(f: string = findRoot(cwd()), file: string | undefined = undefined) {
  // if file contain , split by comma and return the array
  let files = file?.split(',')
  files ??= [join(f, PACKNAME)]
  if (files) {
    for (const file of files) {
      if (!existsSync(file)) {
        const message = `Package.json at ${file} does not exist`
        log.error(message)
        throw new Error(message)
      }
    }
  }
  const dependencies = new Map<string, string>()

  // Import createRequire once for use in version resolution
  const { createRequire } = await import('node:module')

  for (const file of files) {
    const packageJson = readFileSync(file)
    const pkg = JSON.parse(packageJson as any)
    const packageDir = dirname(file)

    // Helper function to resolve actual installed version from node_modules
    const resolveInstalledVersion = (depName: string, declaredVersion: string): string => {
      // Try to find the actual installed version from node_modules
      try {
        // Use require.resolve to find the package
        const requireFromBase = createRequire(join(packageDir, 'package.json'))
        const resolvedPath = requireFromBase.resolve(`${depName}/package.json`)
        const depPkg = JSON.parse(readFileSync(resolvedPath, 'utf-8'))
        if (depPkg.version) {
          return depPkg.version
        }
      }
      catch {
        // require.resolve failed, try direct node_modules lookup
      }

      // Walk up directories looking for node_modules (handles monorepos with hoisting)
      let currentDir = packageDir
      const root = path.parse(currentDir).root
      while (currentDir !== root) {
        const nodeModulesPath = join(currentDir, 'node_modules', depName, PACKNAME)
        if (existsSync(nodeModulesPath)) {
          try {
            const depPkg = JSON.parse(readFileSync(nodeModulesPath, 'utf-8'))
            if (depPkg.version) {
              return depPkg.version
            }
          }
          catch {
            // Continue walking up
          }
        }
        const parentDir = dirname(currentDir)
        if (parentDir === currentDir)
          break
        currentDir = parentDir
      }

      // Fall back to declared version (stripped of ^ and ~)
      return returnVersion(declaredVersion)
    }

    for (const dependency in pkg.dependencies) {
      dependencies.set(dependency, resolveInstalledVersion(dependency, pkg.dependencies[dependency]))
    }
    for (const dependency in pkg.devDependencies) {
      dependencies.set(dependency, resolveInstalledVersion(dependency, pkg.devDependencies[dependency]))
    }
  }
  return dependencies
}

export async function getConfig() {
  try {
    const extConfig = await loadConfig()
    if (!extConfig) {
      const message = 'No capacitor config file found, run `cap init` first'
      log.error(message)
      throw new Error(message)
    }
    return extConfig
  }
  catch (err) {
    const message = `No capacitor config file found, run \`cap init\` first ${formatError(err)}`
    log.error(message)
    throw new Error(message)
  }
}

export async function updateConfigbyKey(key: string, newConfig: any): Promise<ExtConfigPairs> {
  const extConfig = await getConfig()

  if (extConfig?.config) {
    extConfig.config.plugins ??= {}
    extConfig.config.plugins.extConfig ??= {}
    extConfig.config.plugins[key] ??= {}

    extConfig.config.plugins[key] = {
      ...extConfig.config.plugins[key],
      ...newConfig,
    }
    // console.log('extConfig', extConfig)
    await writeConfig(key, extConfig)
  }
  return extConfig
}

export async function updateConfigUpdater(newConfig: any): Promise<ExtConfigPairs> {
  return updateConfigbyKey('CapacitorUpdater', newConfig)
}

export async function getLocalConfig() {
  try {
    const extConfig = await getConfig()
    const capConfig: CapgoConfig = {
      host: (extConfig?.config?.plugins?.CapacitorUpdater?.localHost || defaultHost) as string,
      hostWeb: (extConfig?.config?.plugins?.CapacitorUpdater?.localWebHost || defaultHostWeb) as string,
      hostFilesApi: (extConfig?.config?.plugins?.CapacitorUpdater?.localApiFiles || defaultFileHost) as string,
      hostApi: (extConfig?.config?.plugins?.CapacitorUpdater?.localApi || defaultApiHost) as string,
    }

    if (extConfig?.config?.plugins?.CapacitorUpdater?.localSupa && extConfig?.config?.plugins?.CapacitorUpdater?.localSupaAnon) {
      log.info('Using custom supabase instance from capacitor.config.json')
      capConfig.supaKey = extConfig?.config?.plugins?.CapacitorUpdater?.localSupaAnon
      capConfig.supaHost = extConfig?.config?.plugins?.CapacitorUpdater?.localSupa
    }
    return capConfig
  }
  catch {
    return {
      host: defaultHost,
      hostWeb: defaultHostWeb,
      hostFilesApi: defaultFileHost,
      hostApi: defaultApiHost,
    }
  }
}
// eslint-disable-next-line regexp/no-unused-capturing-group
const nativeFileRegex = /([A-Za-z0-9]+)\.(java|swift|kt|scala)$/

interface CapgoConfig {
  supaHost?: string
  supaKey?: string
  host: string
  hostWeb: string
  hostFilesApi: string
  hostApi: string
}
export async function getRemoteConfig() {
  // call host + /api/get_config and parse the result as json using fetch
  const localConfig = await getLocalConfig()
  try {
    const response = await fetch(`${localConfig.hostApi}/private/config`)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json() as CapgoConfig
    return { ...data, ...localConfig } as CapgoConfig
  }
  catch {
    log.info(`Local config ${formatError(localConfig)}`)
    return localConfig
  }
}

interface CapgoFilesConfig {
  partialUpload: boolean
  partialUploadForced: boolean
  TUSUpload: boolean
  TUSUploadForced: boolean
  maxUploadLength: number
  maxChunkSize: number
  alertUploadSize: number
}

export async function getRemoteFileConfig() {
  const localConfig = await getLocalConfig()
  // call host + /api/get_config and parse the result as json using fetch
  try {
    const response = await fetch(`${localConfig.hostFilesApi}/files/config`)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return await response.json() as CapgoFilesConfig
  }
  catch {
    return {
      partialUpload: false,
      TUSUpload: false,
      partialUploadForced: false,
      TUSUploadForced: false,
      maxUploadLength: MAX_UPLOAD_LENGTH_BYTES,
      maxChunkSize: MAX_CHUNK_SIZE_BYTES,
      alertUploadSize: ALERT_UPLOAD_SIZE_BYTES,
    }
  }
}

export async function createSupabaseClient(apikey: string, supaHost?: string, supaKey?: string) {
  const config = await getRemoteConfig()
  if (supaHost && supaKey) {
    log.info('Using custom supabase instance from provided options')
    config.supaHost = supaHost
    config.supaKey = supaKey
  }
  if (!config.supaHost || !config.supaKey) {
    log.error('Cannot connect to server please try again later')
    throw new Error('Cannot connect to server please try again later')
  }
  return createClient<Database>(config.supaHost, config.supaKey, {
    auth: {
      persistSession: false,
    },
    global: {
      headers: {
        capgkey: apikey,
      },
    },
  })
}

export async function checkKey(supabase: SupabaseClient<Database>, apikey: string, keymode: Database['public']['Enums']['key_mode'][]) {
  const { data: apiAccess } = await supabase
    .rpc('is_allowed_capgkey', { apikey, keymode })
    .single()

  if (!apiAccess) {
    log.error(`Invalid API key or insufficient permissions.`)
    // create a string from keymode array with comma and space and "or" for the last one
    const keymodeStr = keymode.map((k, i) => {
      if (keymode.length === 1)
        return `"${k}"`
      if (i === keymode.length - 1)
        return `or "${k}"`

      return `"${k}", `
    }).join('')
    const message = `Your key should be: ${keymodeStr} mode.`
    log.error(message)
    throw new Error('Invalid API key or insufficient permissions.')
  }
}

export async function isPayingOrg(supabase: SupabaseClient<Database>, orgId: string): Promise<boolean> {
  const { data } = await supabase
    .rpc('is_paying_org', { orgid: orgId })
    .single()
  return data || false
}

export async function isTrialOrg(supabase: SupabaseClient<Database>, orgId: string): Promise<number> {
  const { data } = await supabase
    .rpc('is_trial_org', { orgid: orgId })
    .single()
  return data || 0
}

export async function isAllowedActionOrg(supabase: SupabaseClient<Database>, orgId: string): Promise<boolean> {
  const { data } = await supabase
    .rpc('is_allowed_action_org', { orgid: orgId })
    .single()
  return !!data
}

export async function isAllowedActionAppIdApiKey(supabase: SupabaseClient<Database>, appId: string, apikey: string): Promise<boolean> {
  const { data } = await supabase
    .rpc('is_allowed_action', { apikey, appid: appId })
    .single()

  return !!data
}

export async function isAllowedApp(supabase: SupabaseClient<Database>, apikey: string, appId: string): Promise<boolean> {
  const { data } = await supabase
    .rpc('is_app_owner', { apikey, appid: appId })
    .single()
  return !!data
}

export enum OrganizationPerm {
  none = 0,
  read = 1,
  upload = 2,
  write = 3,
  admin = 4,
  super_admin = 5,
}

export const hasOrganizationPerm = (perm: OrganizationPerm, required: OrganizationPerm): boolean => (perm as number) >= (required as number)

export async function isAllowedAppOrg(supabase: SupabaseClient<Database>, apikey: string, appId: string): Promise<{ okay: true, data: OrganizationPerm } | { okay: false, error: 'INVALID_APIKEY' | 'NO_APP' | 'NO_ORG' }> {
  const { data, error } = await supabase
    .rpc('get_org_perm_for_apikey', { apikey, app_id: appId })
    .single()

  if (error) {
    log.error('Cannot get permissions for organization!')
    console.error(error)
    throw new Error('Cannot get permissions for organization')
  }

  const ok = (data as string).includes('perm')
  if (ok) {
    let perm = null as (OrganizationPerm | null)

    switch (data as string) {
      case 'perm_none': {
        perm = OrganizationPerm.none
        break
      }
      case 'perm_read': {
        perm = OrganizationPerm.read
        break
      }
      case 'perm_upload': {
        perm = OrganizationPerm.upload
        break
      }
      case 'perm_write': {
        perm = OrganizationPerm.write
        break
      }
      case 'perm_admin': {
        perm = OrganizationPerm.admin
        break
      }
      case 'perm_owner': {
        perm = OrganizationPerm.super_admin
        break
      }
      default: {
        if ((data as string).includes('invite')) {
          log.info('Please accept/deny the organization invitation before trying to access the app')
          throw new Error('Organization invitation pending')
        }

        log.error(`Invalid output when fetching organization permission. Response: ${data}`)
        throw new Error(`Invalid output when fetching organization permission. Response: ${data}`)
      }
    }

    return {
      okay: true,
      data: perm,
    }
  }

  // This means that something went wrong here
  let functionError = null as 'INVALID_APIKEY' | 'NO_APP' | 'NO_ORG' | null

  switch (data as string) {
    case 'INVALID_APIKEY': {
      functionError = 'INVALID_APIKEY'
      break
    }
    case 'NO_APP': {
      functionError = 'NO_APP'
      break
    }
    case 'NO_ORG': {
      functionError = 'NO_ORG'
      break
    }
    default: {
      log.error(`Invalid error when fetching organization permission. Response: ${data}`)
      throw new Error(`Invalid error when fetching organization permission. Response: ${data}`)
    }
  }

  return {
    okay: false,
    error: functionError,
  }
}

export async function checkRemoteCliMessages(supabase: SupabaseClient<Database>, orgId: string, cliVersion: string) {
  const { data: messages, error } = await supabase.rpc('get_organization_cli_warnings', { orgid: orgId, cli_version: cliVersion })
  if (error) {
    log.error(`Cannot get cli warnings: ${formatError(error)}`)
    return
  }
  if (messages.length > 0) {
    log.warn(`Found ${messages.length} cli warnings for your organization.`)
    let fatalError: Error | null = null
    for (const message of messages) {
      if (typeof message !== 'object' || typeof (message as any).message !== 'string' || typeof (message as any).fatal !== 'boolean') {
        log.error(`Invalid cli warning: ${message}`)
        continue
      }
      const msg = (message as any) as { message: string, fatal: boolean }
      if (msg.fatal) {
        log.error(`${msg.message.replaceAll('\\n', '\n')}`)
        fatalError = new Error(msg.message)
      }
      else {
        log.warn(`${msg.message.replaceAll('\\n', '\n')}`)
      }
    }
    if (fatalError) {
      log.error('Please fix the warnings and try again.')
      throw fatalError
    }
    log.info('End of cli warnings.')
  }
}

export async function checkPlanValid(supabase: SupabaseClient<Database>, orgId: string, apikey: string, appId?: string, warning = true) {
  const config = await getRemoteConfig()

  // isAllowedActionAppIdApiKey was updated in the orgs_v3 migration to work with the new system
  const validPlan = await (appId ? isAllowedActionAppIdApiKey(supabase, appId, apikey) : isAllowedActionOrg(supabase, orgId))
  if (!validPlan) {
    log.error(`You need to upgrade your plan to continue to use capgo.\n Upgrade here: ${config.hostWeb}/settings/organization/plans\n`)
    wait(100)
    import('open')
      .then((module) => {
        module.default(`${config.hostWeb}/settings/organization/plans`)
      })
    wait(500)
    throw new Error('Plan upgrade required')
  }
  const [trialDays, ispaying] = await Promise.all([
    isTrialOrg(supabase, orgId),
    isPayingOrg(supabase, orgId),
  ])
  if (trialDays > 0 && warning && !ispaying)
    log.warn(`WARNING !!\nTrial expires in ${trialDays} days, upgrade here: ${config.hostWeb}/settings/organization/plans\n`)
}

export async function checkPlanValidUpload(supabase: SupabaseClient<Database>, orgId: string, apikey: string, appId?: string, warning = true) {
  const config = await getRemoteConfig()

  // isAllowedActionAppIdApiKey was updated in the orgs_v3 migration to work with the new system
  const { data: validPlan } = await supabase.rpc('is_allowed_action_org_action', { orgid: orgId, actions: ['storage'] })
  if (!validPlan) {
    log.error(`You need to upgrade your plan to continue to use capgo.\n Upgrade here: ${config.hostWeb}/settings/organization/plans\n`)
    wait(100)
    import('open')
      .then((module) => {
        module.default(`${config.hostWeb}/settings/organization/plans`)
      })
    wait(500)
    throw new Error('Plan upgrade required for upload')
  }
  const [trialDays, ispaying] = await Promise.all([
    isTrialOrg(supabase, orgId),
    isPayingOrg(supabase, orgId),
  ])
  if (trialDays > 0 && warning && !ispaying)
    log.warn(`WARNING !!\nTrial expires in ${trialDays} days, upgrade here: ${config.hostWeb}/settings/organization/plans\n`)
}

export function findSavedKey(quiet = false) {
  const envKey = env.CAPGO_TOKEN?.trim()
  if (envKey) {
    if (!quiet)
      log.info('Use CAPGO_TOKEN environment variable')
    return envKey
  }
  // search for key in home dir
  const userHomeDir = homedir()
  let key
  let keyPath = `${userHomeDir}/.capgo`
  if (existsSync(keyPath)) {
    if (!quiet)
      log.info(`Use global API key ${keyPath}`)
    key = readFileSync(keyPath, 'utf8').trim()
  }
  keyPath = `.capgo`
  if (!key && existsSync(keyPath)) {
    if (!quiet)
      log.info(`Use local API key ${keyPath}`)
    key = readFileSync(keyPath, 'utf8').trim()
  }
  if (!key) {
    const message = `Cannot find API key in local folder or global, please login first with ${getPMAndCommand().runner} @capgo/cli login`
    log.error(message)
    throw new Error(message)
  }
  return key
}

async function* getFiles(dir: string): AsyncGenerator<string> {
  const dirents = await readdirSync(dir, { withFileTypes: true })
  for (const dirent of dirents) {
    const res = resolve(dir, dirent.name)
    if (
      dirent.isDirectory()
      && !dirent.name.startsWith('.')
      && !dirent.name.startsWith('node_modules')
      && !dirent.name.startsWith('dist')
    ) {
      yield* getFiles(res)
    }
    else {
      yield res
    }
  }
}

export function getContentType(filename: string): string | null {
  const imageExtensions = /\.(jpg|jpeg|png|gif|bmp|webp)$/i
  const match = filename.match(imageExtensions)
  if (match) {
    const ext = match[1].toLowerCase()
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg'
      case 'png':
        return 'image/png'
      case 'webp':
        return 'image/webp'
    }
  }
  return null
}

export async function findProjectType() {
  // for nuxtjs check if nuxt.config.js exists
  // for nextjs check if next.config.js exists
  // for angular check if angular.json exists
  // for sveltekit check if svelte.config.js exists or svelte is in package.json dependencies
  // for vue check if vue.config.js exists or vue is in package.json dependencies
  // for react check if package.json exists and react is in dependencies
  const pwd = cwd()
  let isTypeScript = false

  // Check for TypeScript configuration file
  const tsConfigPath = resolve(pwd, 'tsconfig.json')
  if (existsSync(tsConfigPath)) {
    isTypeScript = true
  }

  for await (const f of getFiles(pwd)) {
    // find number of folder in path after pwd
    if (f.includes('angular.json')) {
      log.info('Found angular project')
      return isTypeScript ? 'angular-ts' : 'angular-js'
    }
    if (f.includes('nuxt.config.js') || f.includes('nuxt.config.ts')) {
      log.info('Found nuxtjs project')
      return isTypeScript ? 'nuxtjs-ts' : 'nuxtjs-js'
    }
    if (f.includes('next.config.js') || f.includes('next.config.mjs')) {
      log.info('Found nextjs project')
      return isTypeScript ? 'nextjs-ts' : 'nextjs-js'
    }
    if (f.includes('svelte.config.js')) {
      log.info('Found sveltekit project')
      return isTypeScript ? 'sveltekit-ts' : 'sveltekit-js'
    }
    if (f.includes('rolluconfig.js')) {
      log.info('Found svelte project')
      return isTypeScript ? 'svelte-ts' : 'svelte-js'
    }
    if (f.includes('vue.config.js')) {
      log.info('Found vue project')
      return isTypeScript ? 'vue-ts' : 'vue-js'
    }
    if (f.includes(PACKNAME)) {
      const folder = dirname(f)
      const dependencies = await getAllPackagesDependencies(folder)
      if (dependencies) {
        if (dependencies.get('react')) {
          log.info('Found react project test')
          return isTypeScript ? 'react-ts' : 'react-js'
        }
        if (dependencies.get('vue')) {
          log.info('Found vue project')
          return isTypeScript ? 'vue-ts' : 'vue-js'
        }
      }
    }
  }

  return 'unknown'
}

export function findMainFileForProjectType(projectType: string, isTypeScript: boolean): string | null {
  if (projectType === 'angular-js' || projectType === 'angular-ts') {
    return isTypeScript ? 'src/main.ts' : 'src/main.js'
  }
  if (projectType === 'nextjs-js' || projectType === 'nextjs-ts') {
    return isTypeScript ? 'src/app/layout.tsx' : 'src/app/layout.js'
  }
  if (projectType === 'svelte-js' || projectType === 'svelte-ts') {
    return isTypeScript ? 'src/main.ts' : 'src/main.js'
  }
  if (projectType === 'vue-js' || projectType === 'vue-ts') {
    return isTypeScript ? 'src/main.ts' : 'src/main.js'
  }
  if (projectType === 'react-js' || projectType === 'react-ts') {
    return isTypeScript ? 'src/index.tsx' : 'src/index.js'
  }
  return null
}
// create a function to find the right command to build the project in static mode depending on the project type

export async function findBuildCommandForProjectType(projectType: string) {
  if (projectType === 'angular') {
    log.info('Angular project detected')
    return 'build'
  }

  if (projectType === 'nuxtjs') {
    log.info('Nuxtjs project detected')
    return 'generate'
  }

  if (projectType === 'nextjs') {
    log.info('Nextjs project detected')
    log.warn('Please make sure you have configured static export in your next.config.js: https://nextjs.org/docs/pages/building-your-application/deploying/static-exports')
    log.warn('Please make sure you have the output: \'export\' and distDir: \'dist\' in your next.config.js')
    const doContinue = await confirmC({ message: 'Do you want to continue?' })
    if (!doContinue) {
      const message = 'Build command selection aborted by user'
      log.error(message)
      throw new Error(message)
    }
    return 'build'
  }

  if (projectType === 'sveltekit') {
    log.info('Sveltekit project detected')
    log.warn('Please make sure you have the adapter-static installed: https://kit.svelte.dev/docs/adapter-static')
    log.warn('Please make sure you have the pages: \'dist\' and assets: \'dest\', in your svelte.config.js adapter')
    const doContinue = await confirmC({ message: 'Do you want to continue?' })
    if (!doContinue) {
      const message = 'Build command selection aborted by user'
      log.error(message)
      throw new Error(message)
    }
    return 'build'
  }

  return 'build'
}

export async function findMainFile() {
  // eslint-disable-next-line regexp/no-unused-capturing-group
  const mainRegex = /(main|index)\.(ts|tsx|js|jsx)$/
  // search for main.ts or main.js in local dir and subdirs
  let mainFile = ''
  const pwd = cwd()
  const pwdL = pwd.split('/').length
  for await (const f of getFiles(pwd)) {
    // find number of folder in path after pwd
    const folders = f.split('/').length - pwdL
    if (folders <= 2 && mainRegex.test(f)) {
      mainFile = f
      log.info(`Found main file here ${f}`)
      break
    }
  }
  return mainFile
}

export async function updateOrCreateVersion(supabase: SupabaseClient<Database>, update: Database['public']['Tables']['app_versions']['Insert']) {
  return supabase.from('app_versions')
    .upsert(update, { onConflict: 'name,app_id' })
    .eq('app_id', update.app_id)
    .eq('name', update.name)
}

export async function uploadUrl(supabase: SupabaseClient<Database>, appId: string, name: string): Promise<string> {
  const data = {
    app_id: appId,
    name,
    version: 0,
  }
  try {
    const pathUploadLink = 'files/upload_link'
    const res = await supabase.functions.invoke(pathUploadLink, { body: JSON.stringify(data) })

    if (res.error) {
      // Handle error case
      if (res.error instanceof FunctionsHttpError) {
        const errorBody = await res.error.context.json()
        log.error(`Upload URL error: ${errorBody.status || JSON.stringify(errorBody)}`)
      }
      else {
        log.error(`Cannot get upload url: ${res.error.message}`)
      }
      return ''
    }

    return res.data.url
  }
  catch (error) {
    log.error(`Cannot get upload url ${formatError(error)}`)
  }
  return ''
}

async function* walkDirectory(dir: string): AsyncGenerator<string> {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkDirectory(fullPath)
    }
    else {
      yield fullPath
    }
  }
}

// Version required for Brotli support with .br extension
export const BROTLI_MIN_UPDATER_VERSION_V5 = '5.10.0'
export const BROTLI_MIN_UPDATER_VERSION_V6 = '6.25.0'
export const BROTLI_MIN_UPDATER_VERSION_V7 = '7.0.30'

export function isDeprecatedPluginVersion(parsedPluginVersion: SemVer, minFive = '5.10.0', minSix = '6.25.0', minSeven = '7.25.0'): boolean {
  // v5 is deprecated if < 5.10.0, v6 is deprecated if < 6.25.0, v7 is deprecated if < 7.25.0
  if (parsedPluginVersion.major === 5 && lessThan(parsedPluginVersion, parse(minFive))) {
    return true
  }
  if (parsedPluginVersion.major === 6 && lessThan(parsedPluginVersion, parse(minSix))) {
    return true
  }
  if (parsedPluginVersion.major === 7 && lessThan(parsedPluginVersion, parse(minSeven))) {
    return true
  }
  return false
}

export async function generateManifest(path: string): Promise<{ file: string, hash: string }[]> {
  const allFiles: { file: string, hash: string }[] = []
  const ignoredFiles = ['.DS_Store', '.git', '.gitignore', 'node_modules', 'package-lock.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.spec.json', 'tsconfig.app.json', 'tsconfig.spec.json', 'tsconfig.app.json', 'tsconfig.spec.json']

  for await (const file of walkDirectory(path)) {
    if (ignoredFiles.some(ignoredFile => file.includes(ignoredFile))) {
      log.info(`Ignoring file ${file}, please ensure you have only required files in your dist folder`)
      continue
    }
    const buffer = readFileSync(file)
    // ignore files with size 0
    if (buffer.length === 0) {
      log.info(`Ignoring empty file ${file}, please ensure you have only required files in your dist folder`)
      continue
    }
    const hash = await getChecksum(buffer, 'sha256')
    let filePath = relative(path, file)
    if (filePath.startsWith('/'))
      filePath = filePath.substring(1)
    allFiles.push({ file: filePath, hash })
  }

  return allFiles
}

export type manifestType = Awaited<ReturnType<typeof generateManifest>>
export interface uploadUrlsType {
  path: string
  hash: string
  uploadLink: string
  finalPath: string
}

export async function zipFile(filePath: string): Promise<Buffer> {
  if (osPlatform() === 'win32') {
    return zipFileWindows(filePath)
  }
  else {
    return zipFileUnix(filePath)
  }
}

export function zipFileUnix(filePath: string) {
  const zip = new AdmZip()
  zip.addLocalFolder(filePath)
  return zip.toBuffer()
}

export async function zipFileWindows(filePath: string): Promise<Buffer> {
  log.info('Zipping file windows mode')
  const zip = new AdmZip()

  const addToZip = (folderPath: string, zipPath: string) => {
    const items = readdirSync(folderPath)

    for (const item of items) {
      const itemPath = join(folderPath, item)
      const stats = statSync(itemPath)

      if (stats.isFile()) {
        const fileContent = readFileSync(itemPath)
        zip.addFile(join(zipPath, item).split(sep).join('/'), fileContent)
      }
      else if (stats.isDirectory()) {
        addToZip(itemPath, join(zipPath, item))
      }
    }
  }

  addToZip(filePath, '')

  return zip.toBuffer()
}

export async function uploadTUS(apikey: string, data: Buffer, orgId: string, appId: string, name: string, spinner: ReturnType<typeof spinnerC>, localConfig: CapgoConfig, chunkSize: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    sendEvent(apikey, {
      channel: 'app',
      event: 'App TUS upload',
      icon: '⏫',
      user_id: orgId,
      tags: {
        'app-id': appId,
      },
      notify: false,
    })
    const upload = new tus.Upload(data as any, {
      endpoint: `${localConfig.hostFilesApi}/files/upload/attachments/`,
      // parallelUploads: multipart,
      chunkSize,
      metadataForPartialUploads: {
        filename: `orgs/${orgId}/apps/${appId}/${name}.zip`,
        filetype: 'application/gzip',
      },
      metadata: {
        filename: `orgs/${orgId}/apps/${appId}/${name}.zip`,
        filetype: 'application/zip',
      },
      headers: {
        Authorization: apikey,
      },
      // Callback for errors which cannot be fixed using retries
      onError(error) {
        log.error(`Error uploading bundle: ${error.message}`)
        if (error instanceof tus.DetailedError) {
          const body = error.originalResponse?.getBody()
          const jsonBody = JSON.parse(body || '{"error": "unknown error"}')
          reject(jsonBody.status || jsonBody.error || jsonBody.message || 'unknown error')
        }
        else {
          reject(error.message || error.toString() || 'unknown error')
        }
      },
      // Callback for reporting upload progress
      onProgress(bytesUploaded, bytesTotal) {
        const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2)
        spinner.message(`Uploaded ${percentage}%`)
      },
      // Callback for once the upload is completed
      async onSuccess() {
        await sendEvent(apikey, {
          channel: 'app',
          event: 'App TUS done',
          icon: '⏫',
          user_id: orgId,
          tags: {
            'app-id': appId,
          },
          notify: false,
        }).catch()
        resolve(true)
      },
    })

    // Start the upload
    upload.start()
  })
}

export async function deletedFailedVersion(supabase: SupabaseClient<Database>, appId: string, name: string): Promise<void> {
  const data = {
    app_id: appId,
    name,
  }
  try {
    const pathFailed = 'private/delete_failed_version'
    const res = await supabase.functions.invoke(pathFailed, { body: JSON.stringify(data), method: 'DELETE' })

    if (res.error) {
      if (res.error instanceof FunctionsHttpError) {
        const errorBody = await res.error.context.json()
        log.error(`Cannot delete failed version: ${errorBody.status || JSON.stringify(errorBody)}`)
      }
      else {
        log.error(`Cannot delete failed version: ${res.error.message}`)
      }
      return
    }

    return res.data?.status
  }
  catch (error) {
    if (error instanceof FunctionsHttpError) {
      const errorBody = await error.context.json()
      log.error(`Cannot delete failed version: ${errorBody.message || JSON.stringify(errorBody)}`)
    }
    else {
      log.error(`Cannot delete failed version: ${formatError(error)}`)
    }
  }
}

export async function updateOrCreateChannel(supabase: SupabaseClient<Database>, update: Database['public']['Tables']['channels']['Insert']) {
  // console.log('updateOrCreateChannel', update)
  if (!update.app_id || !update.name || !update.created_by) {
    log.error('missing app_id, name, or created_by')
    return Promise.reject(new Error('missing app_id, name, or created_by'))
  }

  const { data, error } = await supabase
    .from('channels')
    .select()
    .eq('app_id', update.app_id)
    .eq('name', update.name)
    .single()
  if (data && !error) {
    return supabase
      .from('channels')
      .update(update)
      .eq('app_id', update.app_id)
      .eq('name', update.name)
      .select()
      .single()
  }

  return supabase
    .from('channels')
    .insert(update)
    .select()
    .single()
}

export async function sendEvent(capgkey: string, payload: TrackOptions, verbose?: boolean): Promise<void> {
  try {
    if (verbose) {
      log.info(`Get remove config: for ${payload.event}`)
    }
    const config = await getRemoteConfig()
    if (verbose) {
      log.info(`Sending LogSnag event: ${JSON.stringify(payload)}`)
    }
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 seconds timeout

    try {
      const fetchResponse = await fetch(`${config.hostApi}/private/events`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          'capgkey': capgkey,
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!fetchResponse.ok) {
        throw new Error(`HTTP error! status: ${fetchResponse.status}`)
      }

      const response = await fetchResponse.json() as { error?: string }

      if (response.error) {
        log.error(`Failed to send LogSnag event: ${response.error}`)
      }
    }
    finally {
      clearTimeout(timeoutId)
    }
  }
  catch (error) {
    if (verbose) {
      log.error('Failed to send Stats event details:')
      log.error(formatError(error))
    }
  }
}

export async function getOrganization(supabase: SupabaseClient<Database>, roles: string[]): Promise<Organization> {
  const { error: orgError, data: allOrganizations } = await supabase
    .rpc('get_orgs_v6')

  if (orgError) {
    log.error('Cannot get the list of organizations - exiting')
    log.error(`Error ${JSON.stringify(orgError)}`)
    throw new Error('Cannot get the list of organizations')
  }

  const adminOrgs = allOrganizations.filter(org => !!roles.find(role => role === org.role))

  if (allOrganizations.length === 0) {
    log.error('Could not get organization please create an organization first')
    throw new Error('No organizations available')
  }

  if (adminOrgs.length === 0) {
    log.error(`Could not find organization with roles: ${roles.join(' or ')} please create an organization or ask the admin to add you to the organization with this roles`)
    throw new Error('Could not find organization with required roles')
  }

  const organizationUidRaw = (adminOrgs.length > 1)
    ? await select({
        message: 'Please pick the organization that you want to insert to',
        options: adminOrgs.map((org) => {
          return { value: org.gid, label: org.name }
        }),
      })
    : adminOrgs[0].gid

  if (isCancel(organizationUidRaw)) {
    log.error('Canceled organization selection, exiting')
    throw new Error('Organization selection cancelled')
  }

  const organizationUid = organizationUidRaw as string
  const organization = allOrganizations.find(org => org.gid === organizationUid)!

  log.info(`Using the organization "${organization.name}" as the app owner`)
  return organization
}

export async function verifyUser(supabase: SupabaseClient<Database>, apikey: string, keymod: Database['public']['Enums']['key_mode'][] = ['all']) {
  await checkKey(supabase, apikey, keymod)

  const { data: dataUser, error: userIdError } = await supabase
    .rpc('get_user_id', { apikey })
    .single()

  const userId = (dataUser || '').toString()

  if (!userId || userIdError) {
    log.error(`Cannot auth user with apikey`)
    throw new Error('Cannot authenticate user with provided API key')
  }
  return userId
}

export async function getOrganizationId(supabase: SupabaseClient<Database>, appId: string) {
  const { data, error } = await supabase.from('apps')
    .select('owner_org')
    .eq('app_id', appId)
    .single()

  if (!data || error) {
    log.error(`Cannot get organization id for app id ${appId}`)
    formatError(error)
    throw new Error(`Cannot get organization id for app id ${appId}`)
  }
  return data.owner_org
}

export async function requireUpdateMetadata(supabase: SupabaseClient<Database>, channel: string, appId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('channels')
    .select('disable_auto_update')
    .eq('name', channel)
    .eq('app_id', appId)
    .limit(1)

  if (error) {
    log.error(`Cannot check if disableAutoUpdate is required ${formatError(error)}`)
    throw new Error('Cannot check if disableAutoUpdate is required')
  }

  // Channel does not exist and the default is never 'version_number'
  if (data.length === 0)
    return false

  const { disable_auto_update } = (data[0])
  return disable_auto_update === 'version_number'
}

export function getHumanDate(createdA: string | null) {
  const date = new Date(createdA || '')
  return date.toLocaleString()
}

let pmFetched = false
let pm: PackageManagerType = 'npm'
let pmCommand: InstallCommand = 'install'
let pmRunner: PackageManagerRunner = 'npx'
export function getPMAndCommand() {
  if (pmFetched)
    return { pm, command: pmCommand, installCommand: `${pm} ${pmCommand}`, runner: pmRunner }
  const dir = findRoot(cwd())
  pm = findPackageManagerType(dir, 'npm')
  pmCommand = findInstallCommand(pm)
  pmFetched = true
  pmRunner = findPackageManagerRunner(dir)
  return { pm, command: pmCommand, installCommand: `${pm} ${pmCommand}`, runner: pmRunner }
}

function readDirRecursively(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return readDirRecursively(fullPath)
    }
    else {
      // Use relative path to avoid issues with long paths on Windows
      return fullPath.split(`node_modules${sep}`)[1] || fullPath
    }
  })
  return files
}

/**
 * Read directory recursively and return full paths for all files
 */
function readDirRecursivelyFullPaths(dir: string): string[] {
  if (!existsSync(dir))
    return []

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const files = entries.flatMap((entry) => {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        return readDirRecursivelyFullPaths(fullPath)
      }
      else {
        return fullPath
      }
    })
    return files
  }
  catch {
    return []
  }
}

/**
 * Get additional platform-specific files that should be included in checksum.
 * These files contain platform dependency versions and configurations.
 */
function getPlatformConfigFiles(dependencyFolderPath: string, platform: 'ios' | 'android'): string[] {
  const files: string[] = []

  if (platform === 'ios') {
    // Include .podspec files (CocoaPods dependency versions)
    try {
      const rootFiles = readdirSync(dependencyFolderPath)
      for (const file of rootFiles) {
        if (file.endsWith('.podspec')) {
          files.push(join(dependencyFolderPath, file))
        }
      }
    }
    catch {
      // Ignore errors reading directory
    }

    // Include Package.swift (SPM dependency versions) - can be at root or in ios folder
    const packageSwiftRoot = join(dependencyFolderPath, 'Package.swift')
    const packageSwiftIos = join(dependencyFolderPath, 'ios', 'Package.swift')
    if (existsSync(packageSwiftRoot))
      files.push(packageSwiftRoot)
    if (existsSync(packageSwiftIos))
      files.push(packageSwiftIos)
  }
  else if (platform === 'android') {
    // Include build.gradle files (Android dependency versions)
    const androidDir = join(dependencyFolderPath, 'android')
    const buildGradle = join(androidDir, 'build.gradle')
    const buildGradleKts = join(androidDir, 'build.gradle.kts')

    if (existsSync(buildGradle))
      files.push(buildGradle)
    if (existsSync(buildGradleKts))
      files.push(buildGradleKts)
  }

  return files
}

/**
 * Calculate checksums for iOS and Android native code in a dependency folder.
 * Includes both native source files and platform configuration files
 * (podspec, Package.swift, build.gradle) that define platform dependencies.
 */
async function calculatePlatformChecksums(dependencyFolderPath: string): Promise<{ ios_checksum?: string, android_checksum?: string }> {
  const iosDir = join(dependencyFolderPath, 'ios')
  const androidDir = join(dependencyFolderPath, 'android')

  const calculatePlatformChecksum = async (platformDir: string, platform: 'ios' | 'android'): Promise<string | undefined> => {
    // Get native code files
    const nativeFiles = existsSync(platformDir)
      ? readDirRecursivelyFullPaths(platformDir).filter(f => nativeFileRegex.test(f))
      : []

    // Get platform config files (podspec, Package.swift, build.gradle)
    const configFiles = getPlatformConfigFiles(dependencyFolderPath, platform)

    // Combine and sort all files for consistent checksumming
    const allFiles = [...nativeFiles, ...configFiles].sort((a, b) => a.localeCompare(b))

    if (allFiles.length === 0)
      return undefined

    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256')

    for (const file of allFiles) {
      try {
        // Include relative path in hash to detect file renames/moves
        const relativePath = relative(dependencyFolderPath, file)
        hash.update(relativePath)
        // Include file content
        const content = readFileSync(file)
        hash.update(content)
      }
      catch {
        // Skip files that can't be read
      }
    }

    return hash.digest('hex')
  }

  const [ios_checksum, android_checksum] = await Promise.all([
    calculatePlatformChecksum(iosDir, 'ios'),
    calculatePlatformChecksum(androidDir, 'android'),
  ])

  return { ios_checksum, android_checksum }
}

export async function getLocalDependencies(packageJsonPath: string | undefined, nodeModulesString: string | undefined) {
  const nodeModules = nodeModulesString ? nodeModulesString.split(',') : []
  let dependencies
  try {
    dependencies = await getAllPackagesDependencies('', packageJsonPath)
  }
  catch (err) {
    log.error('Invalid package.json, JSON parsing failed')
    console.error('json parse error: ', err)
    throw err instanceof Error ? err : new Error('Invalid package.json')
  }
  const firstPackageJson = packageJsonPath?.split(',')[0]
  const dir = !firstPackageJson ? findRoot(cwd()) : path.resolve(firstPackageJson).replace(PACKNAME, '')
  if (!dependencies) {
    log.error('Missing dependencies section in package.json')
    throw new Error('Missing dependencies section in package.json')
  }

  for (const [key, value] of Object.entries(dependencies)) {
    if (typeof value !== 'string') {
      log.error(`Invalid dependency ${key}: ${value}, expected string, got ${typeof value}`)
      throw new Error(`Invalid dependency ${key}: expected string version`)
    }
  }

  const nodeModulesPaths = nodeModules.length === 0
    ? [join(cwd(), 'node_modules')]
    : nodeModules

  const anyValidPath = nodeModulesPaths.some(path => existsSync(path))
  if (!anyValidPath) {
    const pm = findPackageManagerType(dir, 'npm')
    const installCmd = findInstallCommand(pm)
    log.error(`Missing node_modules folder at ${nodeModulesPaths.join(', ')}, please run ${pm} ${installCmd}`)
    throw new Error('Missing node_modules folder')
  }

  let anyInvalid = false
  const dependenciesObject = await Promise.all(Array.from(dependencies.entries())
    .map(async ([key, value]) => {
      let dependencyFound = false
      let hasNativeFiles = false
      let actualVersion = value
      let foundDependencyPath: string | undefined

      for (const modulePath of nodeModulesPaths) {
        const dependencyFolderPath = join(modulePath, key)
        if (existsSync(dependencyFolderPath)) {
          dependencyFound = true
          foundDependencyPath = dependencyFolderPath
          // Read actual version from node_modules package.json
          // This handles catalog:, workspace:, link:, and other special specifiers
          try {
            const pkgJsonPath = join(dependencyFolderPath, PACKNAME)
            if (existsSync(pkgJsonPath)) {
              const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
              if (pkgJson.version) {
                actualVersion = pkgJson.version
              }
            }
          }
          catch {
            // If we can't read the package.json, fall back to declared version
          }
          try {
            const files = readDirRecursively(dependencyFolderPath)
            if (files.some(fileName => nativeFileRegex.test(fileName))) {
              hasNativeFiles = true
              break
            }
          }
          catch (error) {
            log.error(`Error reading node_modules files for ${key} package in ${modulePath}`)
            console.error(error)
            throw error instanceof Error ? error : new Error(`Error reading node_modules files for ${key}`)
          }
        }
      }

      if (!dependencyFound) {
        anyInvalid = true
        const pm = findPackageManagerType(dir, 'npm')
        const installCmd = findInstallCommand(pm)
        log.error(`Missing dependency ${key}, please run ${pm} ${installCmd}`)
        return { name: key, version: value }
      }

      // Calculate platform checksums for native packages
      let ios_checksum: string | undefined
      let android_checksum: string | undefined
      if (hasNativeFiles && foundDependencyPath) {
        const checksums = await calculatePlatformChecksums(foundDependencyPath)
        ios_checksum = checksums.ios_checksum
        android_checksum = checksums.android_checksum
      }

      return {
        name: key,
        version: actualVersion,
        native: hasNativeFiles,
        ios_checksum,
        android_checksum,
      }
    })).catch(() => [])

  if (anyInvalid || dependenciesObject.find(a => a.native === undefined)) {
    log.error('Missing dependencies or invalid dependencies')
    log.error('If you use monorepo, workspace or any special package manager you can use the --package-json [path,] and --node-modules [path,] options to make the command work properly')
    throw new Error('Missing dependencies or invalid dependencies')
  }

  return dependenciesObject as { name: string, version: string, native: boolean, ios_checksum?: string, android_checksum?: string }[]
}

interface ChannelChecksum {
  version: {
    checksum: string
  }
}

export async function getRemoteChecksums(supabase: SupabaseClient<Database>, appId: string, channel: string) {
  const { data, error } = await supabase
    .from('channels')
    .select(`version(checksum)`)
    .eq('name', channel)
    .eq('app_id', appId)
    .single()
  const channelData = data as any as ChannelChecksum

  if (error
    || channelData === null
    || !channelData.version
    || !channelData.version.checksum
  ) {
    return null
  }

  return channelData.version.checksum
}

export interface NativePackage {
  name: string
  version: string
  ios_checksum?: string
  android_checksum?: string
}

export function convertNativePackages(nativePackages: NativePackage[]): Map<string, NativePackage> {
  if (!nativePackages) {
    log.error(`Error parsing native packages, perhaps the metadata does not exist in Capgo?`)
    throw new Error('Error parsing native packages')
  }

  // Check types
  for (const data of nativePackages) {
    if (typeof data !== 'object') {
      log.error(`Invalid remote native package data: ${data}, expected object, got ${typeof data}`)
      throw new Error('Invalid remote native package data')
    }

    const { name, version } = data
    if (!name || typeof name !== 'string') {
      log.error(`Invalid remote native package name: ${name}, expected string, got ${typeof name}`)
      throw new Error('Invalid remote native package name')
    }

    if (!version || typeof version !== 'string') {
      log.error(`Invalid remote native package version: ${version}, expected string, got ${typeof version}`)
      throw new Error('Invalid remote native package version')
    }
  }

  const mappedRemoteNativePackages = new Map((nativePackages)
    .map(a => [a.name, a]))

  return mappedRemoteNativePackages
}

export async function getRemoteDependencies(supabase: SupabaseClient<Database>, appId: string, channel: string) {
  const { data: remoteNativePackages, error } = await supabase
    .from('channels')
    .select(`version ( 
            native_packages 
        )`)
    .eq('name', channel)
    .eq('app_id', appId)
    .single()

  if (error) {
    log.error(`Error fetching native packages: ${error.message}`)
    throw new Error(`Error fetching native packages: ${error.message}`)
  }
  return convertNativePackages((remoteNativePackages.version.native_packages as any) ?? [])
}

export async function checkChecksum(supabase: SupabaseClient<Database>, appId: string, channel: string, currentChecksum: string) {
  const s = spinnerC()
  s.start(`Checking bundle checksum compatibility with channel ${channel}`)
  const remoteChecksum = await getRemoteChecksums(supabase, appId, channel)

  if (!remoteChecksum) {
    s.stop(`No checksum found for channel ${channel}, the bundle will be uploaded`)
    return
  }
  if (remoteChecksum && remoteChecksum === currentChecksum) {
    // cannot upload the same bundle - stop spinner before throwing
    s.stop(`Checksum check failed`)
    log.error(`Cannot upload the same bundle content.\nCurrent bundle checksum matches remote bundle for channel ${channel}\nDid you build your app before uploading?\nPS: You can ignore this check with "--ignore-checksum-check"`)
    throw new Error('Cannot upload the same bundle content')
  }
  s.stop(`Checksum compatible with ${channel} channel`)
}

export interface Compatibility {
  name: string
  localVersion: string | undefined
  remoteVersion: string | undefined
  // Platform checksums for detailed change detection
  localIosChecksum?: string
  remoteIosChecksum?: string
  localAndroidChecksum?: string
  remoteAndroidChecksum?: string
}

export type IncompatibilityReason
  = | 'new_plugin' // Plugin exists locally but not on remote
    | 'removed_plugin' // Plugin exists on remote but not locally
    | 'version_mismatch' // Versions don't intersect
    | 'ios_code_changed' // iOS native code changed (same version but different checksum)
    | 'android_code_changed' // Android native code changed (same version but different checksum)
    | 'both_platforms_changed' // Both iOS and Android native code changed

export interface CompatibilityDetails {
  compatible: boolean
  reasons: IncompatibilityReason[]
  message: string
}

export function getAppId(appId: string | undefined, config: CapacitorConfig | undefined) {
  const finalAppId = appId || config?.plugins?.CapacitorUpdater?.appId || config?.appId
  return finalAppId
}

/**
 * Check if a package is compatible and return detailed reasons if not
 */
export function getCompatibilityDetails(pkg: Compatibility): CompatibilityDetails {
  const reasons: IncompatibilityReason[] = []

  // If no local version, it's compatible (remote-only package - being removed is ok for OTA)
  if (!pkg.localVersion) {
    return {
      compatible: true,
      reasons: [],
      message: 'Package only exists on remote (will be removed)',
    }
  }

  // If local version but no remote version, it's a new plugin
  if (!pkg.remoteVersion) {
    reasons.push('new_plugin')
    return {
      compatible: false,
      reasons,
      message: `New native plugin added (requires app store update)`,
    }
  }

  // Check version compatibility
  let versionsCompatible = false
  try {
    const localRange = parseRange(pkg.localVersion)
    const remoteRange = parseRange(pkg.remoteVersion)
    versionsCompatible = rangeIntersects(localRange, remoteRange)
  }
  catch {
    versionsCompatible = false
  }

  if (!versionsCompatible) {
    reasons.push('version_mismatch')
  }

  // Check checksum changes (even if versions match, native code could have changed)
  const iosChanged = pkg.localIosChecksum && pkg.remoteIosChecksum && pkg.localIosChecksum !== pkg.remoteIosChecksum
  const androidChanged = pkg.localAndroidChecksum && pkg.remoteAndroidChecksum && pkg.localAndroidChecksum !== pkg.remoteAndroidChecksum

  if (iosChanged && androidChanged) {
    reasons.push('both_platforms_changed')
  }
  else if (iosChanged) {
    reasons.push('ios_code_changed')
  }
  else if (androidChanged) {
    reasons.push('android_code_changed')
  }

  // Build message
  if (reasons.length === 0) {
    return {
      compatible: true,
      reasons: [],
      message: 'Compatible',
    }
  }

  const messages: string[] = []
  for (const reason of reasons) {
    switch (reason) {
      case 'version_mismatch':
        messages.push(`version changed: ${pkg.remoteVersion} → ${pkg.localVersion}`)
        break
      case 'ios_code_changed':
        messages.push('iOS native code changed')
        break
      case 'android_code_changed':
        messages.push('Android native code changed')
        break
      case 'both_platforms_changed':
        messages.push('iOS and Android native code changed')
        break
      case 'new_plugin':
        messages.push('new plugin (requires app store update)')
        break
      case 'removed_plugin':
        messages.push('plugin removed')
        break
    }
  }

  return {
    compatible: false,
    reasons,
    message: messages.join(', '),
  }
}

/**
 * Simple compatibility check (backward compatible)
 */
export function isCompatible(pkg: Compatibility): boolean {
  return getCompatibilityDetails(pkg).compatible
}

export async function checkCompatibilityCloud(supabase: SupabaseClient<Database>, appId: string, channel: string, packageJsonPath: string | undefined, nodeModules: string | undefined) {
  const dependenciesObject = await getLocalDependencies(packageJsonPath, nodeModules)
  const mappedRemoteNativePackages = await getRemoteDependencies(supabase, appId, channel)

  const finalDependencies: Compatibility[] = dependenciesObject
    .filter(a => !!a.native)
    .map((local) => {
      const remotePackage = mappedRemoteNativePackages.get(local.name)
      if (remotePackage) {
        return {
          name: local.name,
          localVersion: local.version,
          remoteVersion: remotePackage.version,
          localIosChecksum: local.ios_checksum,
          remoteIosChecksum: remotePackage.ios_checksum,
          localAndroidChecksum: local.android_checksum,
          remoteAndroidChecksum: remotePackage.android_checksum,
        }
      }

      return {
        name: local.name,
        localVersion: local.version,
        remoteVersion: undefined,
        localIosChecksum: local.ios_checksum,
        localAndroidChecksum: local.android_checksum,
      }
    })

  // Only include remote packages that are not in local for informational purposes
  // These won't affect compatibility
  const removeNotInLocal = [...mappedRemoteNativePackages]
    .filter(([remoteName]) => dependenciesObject.find(a => a.name === remoteName) === undefined)
    .map(([name, pkg]) => ({
      name,
      localVersion: undefined,
      remoteVersion: pkg.version,
      remoteIosChecksum: pkg.ios_checksum,
      remoteAndroidChecksum: pkg.android_checksum,
    }))

  finalDependencies.push(...removeNotInLocal)

  return {
    finalCompatibility: finalDependencies,
    localDependencies: dependenciesObject,
  }
}

export async function checkCompatibilityNativePackages(supabase: SupabaseClient<Database>, appId: string, channel: string, nativePackages: NativePackage[]) {
  const mappedRemoteNativePackages = await getRemoteDependencies(supabase, appId, channel)

  const finalDependencies: Compatibility[] = nativePackages
    .map((local) => {
      const remotePackage = mappedRemoteNativePackages.get(local.name)
      if (remotePackage) {
        return {
          name: local.name,
          localVersion: local.version,
          remoteVersion: remotePackage.version,
          localIosChecksum: local.ios_checksum,
          remoteIosChecksum: remotePackage.ios_checksum,
          localAndroidChecksum: local.android_checksum,
          remoteAndroidChecksum: remotePackage.android_checksum,
        }
      }

      return {
        name: local.name,
        localVersion: local.version,
        remoteVersion: undefined,
        localIosChecksum: local.ios_checksum,
        localAndroidChecksum: local.android_checksum,
      }
    })

  // Only include remote packages that are not in local for informational purposes
  // These won't affect compatibility
  const removeNotInLocal = [...mappedRemoteNativePackages]
    .filter(([remoteName]) => nativePackages.find(a => a.name === remoteName) === undefined)
    .map(([name, pkg]) => ({
      name,
      localVersion: undefined,
      remoteVersion: pkg.version,
      remoteIosChecksum: pkg.ios_checksum,
      remoteAndroidChecksum: pkg.android_checksum,
    }))

  finalDependencies.push(...removeNotInLocal)

  return {
    finalCompatibility: finalDependencies,
    localDependencies: nativePackages,
  }
}

export async function promptAndSyncCapacitor(
  isInit?: boolean,
  orgId?: string,
  apikey?: string,
): Promise<void> {
  // Ask user if they want to sync with Capacitor
  const shouldSync = await confirmC({
    message: 'Would you like to sync your project with Capacitor now? This is recommended to ensure encrypted updates work properly.',
  })

  // Handle user cancellation
  if (isCancel(shouldSync)) {
    // For init flow, mark the cancellation
    if (isInit && orgId && apikey) {
      await markSnag('onboarding-v2', orgId, apikey, 'canceled', '🤷')
    }
    log.error('Canceled Capacitor sync')
    throw new Error('Capacitor sync cancelled')
  }

  if (shouldSync) {
    const pm = getPMAndCommand()
    const s = spinnerC()
    s.start('Running the command...')

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(pm.runner, ['cap', 'sync'], { stdio: 'pipe' })

        child.on('close', (code) => {
          if (code === 0) {
            resolve()
          }
          else {
            reject(new Error(`Command failed with exit code ${code}`))
          }
        })

        child.on('error', (error) => {
          reject(error)
        })
      })

      s.stop('Capacitor sync completed ✅')
    }
    catch (error) {
      s.stop('Error')
      log.error(`Failed to run Capacitor sync: ${error}`)
      log.warn(`Please run "${pm.runner} cap sync" manually to ensure encrypted updates work properly`)
    }
  }
  else {
    const pm = getPMAndCommand()
    log.warn('⚠️  Important: If you upload encrypted bundles without syncing, updates will fail!')
    log.info(`Remember to run "${pm.runner} cap sync" before uploading encrypted bundles`)
  }
}
