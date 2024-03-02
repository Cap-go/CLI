import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { loadConfig } from '@capacitor/cli/dist/config'
import { program } from 'commander'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import prettyjson from 'prettyjson'
import { LogSnag } from 'logsnag'
import * as p from '@clack/prompts'
import ky from 'ky'
import { promiseFiles } from 'node-dir'
import type { Database } from './types/supabase.types'

export const baseKey = '.capgo_key'
export const baseKeyPub = `${baseKey}.pub`
export const defaultHost = 'https://capgo.app'
export const defaultApiHost = 'https://api.capgo.app'
export const defaultHostWeb = 'https://web.capgo.app'

export const regexSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
export const formatError = (error: any) => error ? `\n${prettyjson.render(error)}` : ''

export interface OptionsBase {
  apikey: string
}

export async function getConfig() {
  let config: Config
  try {
    config = await loadConfig()
  }
  catch (err) {
    p.log.error('No capacitor config file found, run `cap init` first')
    program.error('')
  }
  return config
}

export async function getLocalConfig() {
  try {
    const config: Config = await getConfig()
    const capConfig: Partial<CapgoConfig> = {
      host: (config?.app?.extConfig?.plugins?.CapacitorUpdater?.localHost || defaultHost) as string,
      hostWeb: (config?.app?.extConfig?.plugins?.CapacitorUpdater?.localWebHost || defaultHostWeb) as string,
    }

    if (config?.app?.extConfig?.plugins?.CapacitorUpdater?.localSupa && config?.app?.extConfig?.plugins?.CapacitorUpdater?.localSupaAnon) {
      p.log.info('Using custom supabase instance from capacitor.config.json')
      capConfig.supaKey = config?.app?.extConfig?.plugins?.CapacitorUpdater?.localSupaAnon
      capConfig.supaHost = config?.app?.extConfig?.plugins?.CapacitorUpdater?.localSupa
    }
    return capConfig
  }
  catch (error) {
    return {
      host: defaultHost,
      hostWeb: defaultHostWeb,
    }
  }
}

const nativeFileRegex = /([A-Za-z0-9]+)\.(java|swift|kt|scala)$/

interface CapgoConfig {
  supaHost: string
  supaKey: string
  host: string
  hostWeb: string
  signKey: string
}
export async function getRemoteConfig() {
  // call host + /api/get_config and parse the result as json using axios
  const localConfig = await getLocalConfig()
  return ky
    .get(`${defaultApiHost}/private/config`)
    .then(res => res.json<CapgoConfig>())
    .then(data => ({ ...data, ...localConfig } as CapgoConfig))
    .catch(() => {
      p.log.info(`Local config ${formatError(localConfig)}`)
      return localConfig
    })
}

export async function createSupabaseClient(apikey: string) {
  const config = await getRemoteConfig()
  if (!config.supaHost || !config.supaKey) {
    p.log.error('Cannot connect to server please try again later')
    program.error('')
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
    p.log.error(`Invalid API key or insufficient permissions.`)
    // create a string from keymode array with comma and space and "or" for the last one
    const keymodeStr = keymode.map((k, i) => {
      if (i === keymode.length - 1)
        return `or ${k}`

      return `${k}, `
    }).join('')
    p.log.error(`Your key should be: ${keymodeStr} mode.`)
    program.error('')
  }
}

export async function isGoodPlan(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data } = await supabase
    .rpc('is_good_plan_v5', { userid: userId })
    .single()
  return data || false
}

export async function isPaying(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data } = await supabase
    .rpc('is_paying', { userid: userId })
    .single()
  return data || false
}

export async function isTrial(supabase: SupabaseClient<Database>, userId: string): Promise<number> {
  const { data } = await supabase
    .rpc('is_trial', { userid: userId })
    .single()
  return data || 0
}

export async function isAllowedAction(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data } = await supabase
    .rpc('is_allowed_action_user', { userid: userId })
    .single()
  return !!data
}

export async function isAllowedActionAppIdApiKey(supabase: SupabaseClient<Database>, appId: string, apikey: string): Promise<boolean> {
  const { data } = await supabase
    .rpc('is_allowed_action', { apikey, appid: appId })
    .single()

  return !!data
}

export async function getAppOwner(supabase: SupabaseClient<Database>, appId: string): Promise<string> {
  const { data, error } = await supabase
    .from('apps')
    .select('user_id')
    .eq('app_id', appId)
    .single()

  if (error) {
    p.log.error('Cannot get app owner, exiting')
    p.log.error('Please report the following error to capgo\'s staff')
    console.error(error)
    process.exit(1)
  }

  return data.user_id
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
  owner = 5,
}

export const hasOrganizationPerm = (perm: OrganizationPerm, required: OrganizationPerm): boolean => (perm as number) >= (required as number)

export async function isAllowedAppOrg(supabase: SupabaseClient<Database>, apikey: string, appId: string): Promise<{ okay: true, data: OrganizationPerm } | { okay: false, error: 'INVALID_APIKEY' | 'NO_APP' | 'NO_ORG' }> {
  const { data, error } = await supabase
    .rpc('get_org_perm_for_apikey', { apikey, app_id: appId })
    .single()

  if (error) {
    p.log.error('Cannot get permissions for organization!')
    console.error(error)
    process.exit(1)
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
        perm = OrganizationPerm.owner
        break
      }
      default: {
        if ((data as string).includes('invite')) {
          p.log.info('Please accept/deny the organization invitation before trying to access the app')
          process.exit(1)
        }

        p.log.error(`Invalid output when fetching organization permission. Response: ${data}`)
        process.exit(1)
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
      p.log.error(`Invalid error when fetching organization permission. Response: ${data}`)
      process.exit(1)
    }
  }

  return {
    okay: false,
    error: functionError,
  }
}

export async function checkPlanValid(supabase: SupabaseClient<Database>, userId: string, appId: string, apikey: string, warning = true) {
  const config = await getRemoteConfig()
  const validPlan = await isAllowedActionAppIdApiKey(supabase, appId, apikey)
  if (!validPlan) {
    p.log.error(`You need to upgrade your plan to continue to use capgo.\n Upgrade here: ${config.hostWeb}/dashboard/settings/plans\n`)
    setTimeout(() => {
      import('open')
        .then((module) => {
          module.default(`${config.hostWeb}/dashboard/settings/plans`)
        })
      program.error('')
    }, 1000)
  }
  const trialDays = await isTrial(supabase, userId)
  const ispaying = await isPaying(supabase, userId)
  if (trialDays > 0 && warning && !ispaying)
    p.log.warn(`WARNING !!\nTrial expires in ${trialDays} days, upgrade here: ${config.hostWeb}/dashboard/settings/plans\n`)
}

export function findSavedKey(quiet = false) {
  // search for key in home dir
  const userHomeDir = homedir()
  let key
  let keyPath = `${userHomeDir}/.capgo`
  if (existsSync(keyPath)) {
    if (!quiet)
      p.log.info(`Use global apy key ${keyPath}`)
    key = readFileSync(keyPath, 'utf8').trim()
  }
  keyPath = `.capgo`
  if (!key && existsSync(keyPath)) {
    if (!quiet)
      p.log.info(`Use local apy key ${keyPath}`)
    key = readFileSync(keyPath, 'utf8').trim()
  }
  if (!key) {
    p.log.error(`Cannot find API key in local folder or global, please login first with npx @capacitor/cli login`)
    program.error('')
  }
  return key
}

async function* getFiles(dir: string): AsyncGenerator<string> {
  const dirents = await readdirSync(dir, { withFileTypes: true })
  for (const dirent of dirents) {
    const res = resolve(dir, dirent.name)
    if (dirent.isDirectory()
      && !dirent.name.startsWith('.')
      && !dirent.name.startsWith('node_modules')
      && !dirent.name.startsWith('dist'))
      yield * getFiles(res)
    else
      yield res
  }
}
export async function findMainFile() {
  const mainRegex = /(main|index)\.(ts|tsx|js|jsx)$/
  // search for main.ts or main.js in local dir and subdirs
  let mainFile = ''
  const pwd = process.cwd()
  const pwdL = pwd.split('/').length
  for await (const f of getFiles(pwd)) {
    // find number of folder in path after pwd
    const folders = f.split('/').length - pwdL
    if (folders <= 2 && mainRegex.test(f)) {
      mainFile = f
      p.log.info(`Found main file here ${f}`)
      break
    }
  }
  return mainFile
}

interface Config {
  app: {
    appId: string
    appName: string
    webDir: string
    package: {
      version: string
    }
    extConfigFilePath: string
    extConfig: {
      extConfig: object
      plugins: {
        extConfig: object
        CapacitorUpdater: {
          autoUpdate?: boolean
          localS3?: boolean
          localHost?: string
          localWebHost?: string
          localSupa?: string
          localSupaAnon?: string
          statsUrl?: string
          channelUrl?: string
          updateUrl?: string
          privateKey?: string
          publicKey?: string
        }
      }
      server: {
        cleartext: boolean
        url: string
      }
    }
  }
}

export async function updateOrCreateVersion(supabase: SupabaseClient<Database>, update: Database['public']['Tables']['app_versions']['Insert']) {
  return supabase.from('app_versions')
    .upsert(update, { onConflict: 'name,app_id' })
    .eq('app_id', update.app_id)
    .eq('name', update.name)
}

export async function uploadUrl(supabase: SupabaseClient<Database>, appId: string, bucketId: string): Promise<string> {
  const data = {
    app_id: appId,
    bucket_id: bucketId,
  }
  try {
    const pathUploadLink = 'private/upload_link'
    const res = await supabase.functions.invoke(pathUploadLink, { body: JSON.stringify(data) })
    return res.data.url
  }
  catch (error) {
    p.log.error(`Cannot get upload url ${formatError(error)}`)
  }
  return ''
}

export async function updateOrCreateChannel(supabase: SupabaseClient<Database>, update: Database['public']['Tables']['channels']['Insert']) {
  // console.log('updateOrCreateChannel', update)
  if (!update.app_id || !update.name || !update.created_by) {
    p.log.error('missing app_id, name, or created_by')
    return Promise.reject(new Error('missing app_id, name, or created_by'))
  }
  const { data, error } = await supabase
    .from('channels')
    .select('enable_progressive_deploy, secondaryVersionPercentage, secondVersion')
    .eq('app_id', update.app_id)
    .eq('name', update.name)
  // .eq('created_by', update.created_by)
    .single()

  if (data && !error) {
    if (data.enable_progressive_deploy) {
      p.log.info('Progressive deploy is enabled')

      if (data.secondaryVersionPercentage !== 1)
        p.log.warn('Latest progressive deploy has not finished')

      update.secondVersion = update.version
      if (!data.secondVersion) {
        p.log.error('missing secondVersion')
        return Promise.reject(new Error('missing secondVersion'))
      }
      update.version = data.secondVersion
      update.secondaryVersionPercentage = 0.1
      p.log.info('Started new progressive upload!')

      // update.version = undefined
    }
    return supabase
      .from('channels')
      .update(update)
      .eq('app_id', update.app_id)
      .eq('name', update.name)
    // .eq('created_by', update.created_by)
      .select()
      .single()
  }

  return supabase
    .from('channels')
    .insert(update)
    .select()
    .single()
}

export function useLogSnag(): LogSnag {
  const logsnag = new LogSnag({
    token: 'c124f5e9d0ce5bdd14bbb48f815d5583',
    project: 'capgo',
  })
  return logsnag
}

export const convertAppName = (appName: string) => appName.replace(/\./g, '--')

export async function verifyUser(supabase: SupabaseClient<Database>, apikey: string, keymod: Database['public']['Enums']['key_mode'][] = ['all']) {
  await checkKey(supabase, apikey, keymod)

  const { data: dataUser, error: userIdError } = await supabase
    .rpc('get_user_id', { apikey })
    .single()

  const userId = (dataUser || '').toString()

  if (!userId || userIdError) {
    p.log.error(`Cannot auth user with apikey`)
    program.error('')
  }
  return userId
}

export async function requireUpdateMetadata(supabase: SupabaseClient<Database>, channel: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('channels')
    .select('disableAutoUpdate')
    .eq('name', channel)
    .limit(1)

  if (error) {
    p.log.error(`Cannot check if disableAutoUpdate is required ${formatError(error)}`)
    program.error('')
  }

  // Channel does not exist and the default is never 'version_number'
  if (data.length === 0)
    return false

  const { disableAutoUpdate } = (data[0])
  return disableAutoUpdate === 'version_number'
}

export function getHumanDate(createdA: string | null) {
  const date = new Date(createdA || '')
  return date.toLocaleString()
}

export async function getLocalDepenencies() {
  if (!existsSync('./package.json')) {
    p.log.error('Missing package.json, you need to be in a capacitor project')
    program.error('')
  }

  let packageJson
  try {
    packageJson = JSON.parse(readFileSync('./package.json', 'utf8'))
  }
  catch (err) {
    p.log.error('Invalid package.json, JSON parsing failed')
    console.error('json parse error: ', err)
    program.error('')
  }

  const { dependencies } = packageJson
  if (!dependencies) {
    p.log.error('Missing dependencies section in package.json')
    program.error('')
  }

  for (const [key, value] of Object.entries(dependencies)) {
    if (typeof value !== 'string') {
      p.log.error(`Invalid dependency ${key}: ${value}, expected string, got ${typeof value}`)
      program.error('')
    }
  }

  if (!existsSync('./node_modules/')) {
    p.log.error('Missing node_modules folder, please run npm install')
    program.error('')
  }

  let anyInvalid = false

  const dependenciesObject = await Promise.all(Object.entries(dependencies as Record<string, string>)

    .map(async ([key, value]) => {
      const dependencyFolderExists = existsSync(`./node_modules/${key}`)

      if (!dependencyFolderExists) {
        anyInvalid = true
        p.log.error(`Missing dependency ${key}, please run npm install`)
        return { name: key, version: value }
      }

      let hasNativeFiles = false
      await promiseFiles(`./node_modules/${key}`)
        .then((files) => {
          if (files.find(fileName => nativeFileRegex.test(fileName)))
            hasNativeFiles = true
        })
        .catch((error) => {
          p.log.error(`Error reading node_modulses files for ${key} package`)
          console.error(error)
          program.error('')
        })

      return {
        name: key,
        version: value,
        native: hasNativeFiles,
      }
    })).catch(() => [])

  if (anyInvalid || dependenciesObject.find(a => a.native === undefined))
    program.error('')

  return dependenciesObject as { name: string, version: string, native: boolean }[]
}

export async function getRemoteDepenencies(supabase: SupabaseClient<Database>, appId: string, channel: string) {
  const { data: remoteNativePackages, error } = await supabase
    .from('channels')
    .select(`version ( 
            native_packages 
        )`)
    .eq('name', channel)
    .eq('app_id', appId)
    .single()

  if (error) {
    p.log.error(`Error fetching native packages: ${error.message}`)
    program.error('')
  }

  let castedRemoteNativePackages
  try {
    castedRemoteNativePackages = (remoteNativePackages as any).version.native_packages
  }
  catch (err) {
    // If we do not do this we will get an unreadable
    p.log.error(`Error parsing native packages`)
    program.error('')
  }

  if (!castedRemoteNativePackages) {
    p.log.error(`Error parsing native packages, perhaps the metadata does not exist?`)
    program.error('')
  }

  // Check types
  castedRemoteNativePackages.forEach((data: any) => {
    if (typeof data !== 'object') {
      p.log.error(`Invalid remote native package data: ${data}, expected object, got ${typeof data}`)
      program.error('')
    }

    const { name, version } = data
    if (!name || typeof name !== 'string') {
      p.log.error(`Invalid remote native package name: ${name}, expected string, got ${typeof name}`)
      program.error('')
    }

    if (!version || typeof version !== 'string') {
      p.log.error(`Invalid remote native package version: ${version}, expected string, got ${typeof version}`)
      program.error('')
    }
  })

  const mappedRemoteNativePackages = new Map((castedRemoteNativePackages as { name: string, version: string }[])
    .map(a => [a.name, a]))

  return mappedRemoteNativePackages
}

export async function checkCompatibility(supabase: SupabaseClient<Database>, appId: string, channel: string) {
  const dependenciesObject = await getLocalDepenencies()
  const mappedRemoteNativePackages = await getRemoteDepenencies(supabase, appId, channel)

  const finalDepenencies:
  ({
    name: string
    localVersion: string
    remoteVersion: string
  } | {
    name: string
    localVersion: string
    remoteVersion: undefined
  } | {
    name: string
    localVersion: undefined
    remoteVersion: string
  })[] = dependenciesObject
    .filter(a => !!a.native)
    .map((local) => {
      const remotePackage = mappedRemoteNativePackages.get(local.name)
      if (remotePackage) {
        return {
          name: local.name,
          localVersion: local.version,
          remoteVersion: remotePackage.version,
        }
      }

      return {
        name: local.name,
        localVersion: local.version,
        remoteVersion: undefined,
      }
    })

  const removeNotInLocal = [...mappedRemoteNativePackages]
    .filter(([remoteName]) => dependenciesObject.find(a => a.name === remoteName) === undefined)
    .map(([name, version]) => ({ name, localVersion: undefined, remoteVersion: version.version }))

  finalDepenencies.push(...removeNotInLocal)

  return {
    finalCompatibility: finalDepenencies,
    localDependencies: dependenciesObject,
  }
}
