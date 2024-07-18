import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, platform as osPlatform } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { cwd, env, exit } from 'node:process'
import type { Buffer } from 'node:buffer'
import { program } from 'commander'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import prettyjson from 'prettyjson'
import { LogSnag } from 'logsnag'
import ky from 'ky'
import { findRootSync } from '@manypkg/find-root'
import type { InstallCommand, PackageManagerRunner, PackageManagerType } from '@capgo/find-package-manager'
import { findInstallCommand, findPackageManagerRunner, findPackageManagerType } from '@capgo/find-package-manager'
import AdmZip from 'adm-zip'
import JSZip from 'jszip'
import { confirm as confirmC, isCancel, log, select, spinner } from '@clack/prompts'
import { loadConfig } from './config'
import type { Database } from './types/supabase.types'

export const baseKey = '.capgo_key'
export const baseKeyPub = `${baseKey}.pub`
export const defaultHost = 'https://capgo.app'
export const defaultApiHost = 'https://api.capgo.app'
export const defaultHostWeb = 'https://web.capgo.app'

export type ArrayElement<ArrayType extends readonly unknown[]> =
  ArrayType extends readonly (infer ElementType)[] ? ElementType : never
export type Organization = ArrayElement<Database['public']['Functions']['get_orgs_v5']['Returns']>

export const regexSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*))*))?(?:\+([0-9a-z-]+(?:\.[0-9a-z-]+)*))?$/i
export const formatError = (error: any) => error ? `\n${prettyjson.render(error)}` : ''

export interface OptionsBase {
  apikey: string
}

export function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function readPackageJson() {
  const packageJson = readFileSync(join(cwd(), 'package.json'))
  return JSON.parse(packageJson as any)
}

export async function getConfig() {
  try {
    const extConfig = await loadConfig()
    if (!extConfig) {
      log.error(`No capacitor config file found, run \`cap init\` first`)
      program.error('')
    }
    return extConfig
  }
  catch (err) {
    log.error(`No capacitor config file found, run \`cap init\` first ${formatError(err)}`)
    program.error('')
  }
}

export async function getLocalConfig() {
  try {
    const extConfig = await getConfig()
    const capConfig: Partial<CapgoConfig> = {
      host: (extConfig?.config?.plugins?.CapacitorUpdater?.localHost || defaultHost) as string,
      hostWeb: (extConfig?.config?.plugins?.CapacitorUpdater?.localWebHost || defaultHostWeb) as string,
    }

    if (extConfig?.config?.plugins?.CapacitorUpdater?.localSupa && extConfig?.config?.plugins?.CapacitorUpdater?.localSupaAnon) {
      log.info('Using custom supabase instance from capacitor.config.json')
      capConfig.supaKey = extConfig?.config?.plugins?.CapacitorUpdater?.localSupaAnon
      capConfig.supaHost = extConfig?.config?.plugins?.CapacitorUpdater?.localSupa
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
// eslint-disable-next-line regexp/no-unused-capturing-group
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
      log.info(`Local config ${formatError(localConfig)}`)
      return localConfig
    })
}

export async function createSupabaseClient(apikey: string) {
  const config = await getRemoteConfig()
  if (!config.supaHost || !config.supaKey) {
    log.error('Cannot connect to server please try again later')
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
    log.error(`Invalid API key or insufficient permissions.`)
    // create a string from keymode array with comma and space and "or" for the last one
    const keymodeStr = keymode.map((k, i) => {
      if (i === keymode.length - 1)
        return `or ${k}`

      return `${k}, `
    }).join('')
    log.error(`Your key should be: ${keymodeStr} mode.`)
    program.error('')
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
    exit(1)
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
          exit(1)
        }

        log.error(`Invalid output when fetching organization permission. Response: ${data}`)
        exit(1)
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
      exit(1)
    }
  }

  return {
    okay: false,
    error: functionError,
  }
}

export async function checkPlanValid(supabase: SupabaseClient<Database>, orgId: string, apikey: string, appId?: string, warning = true) {
  const config = await getRemoteConfig()

  // isAllowedActionAppIdApiKey was updated in the orgs_v3 migration to work with the new system
  const validPlan = await (appId ? isAllowedActionAppIdApiKey(supabase, appId, apikey) : isAllowedActionOrg(supabase, orgId))
  if (!validPlan) {
    log.error(`You need to upgrade your plan to continue to use capgo.\n Upgrade here: ${config.hostWeb}/dashboard/settings/plans\n`)
    wait(100)
    import('open')
      .then((module) => {
        module.default(`${config.hostWeb}/dashboard/settings/plans`)
      })
    wait(500)
    program.error('')
  }
  const [trialDays, ispaying] = await Promise.all([
    isTrialOrg(supabase, orgId),
    isPayingOrg(supabase, orgId),
  ])
  if (trialDays > 0 && warning && !ispaying)
    log.warn(`WARNING !!\nTrial expires in ${trialDays} days, upgrade here: ${config.hostWeb}/dashboard/settings/plans\n`)
}

export function findSavedKey(quiet = false) {
  // search for key in home dir
  const userHomeDir = homedir()
  let key
  let keyPath = `${userHomeDir}/.capgo`
  if (existsSync(keyPath)) {
    if (!quiet)
      log.info(`Use global apy key ${keyPath}`)
    key = readFileSync(keyPath, 'utf8').trim()
  }
  keyPath = `.capgo`
  if (!key && existsSync(keyPath)) {
    if (!quiet)
      log.info(`Use local apy key ${keyPath}`)
    key = readFileSync(keyPath, 'utf8').trim()
  }
  if (!key) {
    log.error(`Cannot find API key in local folder or global, please login first with ${getPMAndCommand().runner} @capacitor/cli login`)
    program.error('')
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
      yield * getFiles(res)
    }
    else {
      yield res
    }
  }
}

export async function findProjectType() {
  // for nuxtjs check if nuxt.config.js exists
  // for nextjs check if next.config.js exists
  // for angular check if angular.json exists
  // for sveltekit check if svelte.config.js exists or svelte is in package.json dependancies
  // for vue check if vue.config.js exists or vue is in package.json dependancies
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
    if (f.includes('nuxt.config.js' || f.includes('nuxt.config.ts'))) {
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
    if (f.includes('package.json')) {
      const packageJson = await readPackageJson()
      if (packageJson.dependencies) {
        if (packageJson.dependencies.react) {
          log.info('Found react project test')
          return isTypeScript ? 'react-ts' : 'react-js'
        }
        if (packageJson.dependencies.vue) {
          log.info('Found vue project')
          return isTypeScript ? 'vue-ts' : 'vue-js'
        }
      }
    }
  }

  return 'unknown'
}

export function findMainFileForProjectType(projectType: string, isTypeScript: boolean): string | null {
  if (projectType === 'angular') {
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
      log.error('Aborted')
      program.error('')
    }
    return 'build'
  }

  if (projectType === 'sveltekit') {
    log.info('Sveltekit project detected')
    log.warn('Please make sure you have the adapter-static installed: https://kit.svelte.dev/docs/adapter-static')
    log.warn('Please make sure you have the pages: \'dist\' and assets: \'dest\', in your svelte.config.js adaptater')
    const doContinue = await confirmC({ message: 'Do you want to continue?' })
    if (!doContinue) {
      log.error('Aborted')
      program.error('')
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
    const pathUploadLink = 'private/upload_link'
    const res = await supabase.functions.invoke(pathUploadLink, { body: JSON.stringify(data) })
    return res.data.url
  }
  catch (error) {
    log.error(`Cannot get upload url ${formatError(error)}`)
  }
  return ''
}

async function prepareMultipart(supabase: SupabaseClient<Database>, appId: string, name: string): Promise<{ key: string, uploadId: string, url: string } | null> {
  const data = {
    app_id: appId,
    name,
    version: 1,
  }
  try {
    const pathUploadLink = 'private/upload_link'
    const res = await supabase.functions.invoke(pathUploadLink, { body: JSON.stringify(data) })
    return res.data as any
  }
  catch (error) {
    log.error(`Cannot get upload url ${formatError(error)}`)
    return null
  }
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
  const zip = new JSZip()

  // Helper function to recursively add files and folders to the ZIP archive
  const addToZip = async (folderPath: string, zipPath: string) => {
    const items = readdirSync(folderPath)

    for (const item of items) {
      const itemPath = join(folderPath, item)
      const stats = statSync(itemPath)

      if (stats.isFile()) {
        const fileContent = await readFileSync(itemPath)
        zip.file(join(zipPath, item).split(sep).join('/'), fileContent)
      }
      else if (stats.isDirectory()) {
        await addToZip(itemPath, join(zipPath, item))
      }
    }
  }

  // Start adding files and folders to the ZIP archive
  await addToZip(filePath, '')

  // Generate the ZIP file as a Buffer
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return zipBuffer
}

async function finishMultipartDownload(key: string, uploadId: string, url: string, parts: any[]) {
  const metadata = {
    action: 'mpu-complete',
    uploadId,
    key,
  }

  await ky.post(url, {
    json: {
      parts,
    },
    searchParams: new URLSearchParams({ body: btoa(JSON.stringify(metadata)) }),
  })

  // console.log(await response.json())
}

const PART_SIZE = 10 * 1024 * 1024
export async function uploadMultipart(supabase: SupabaseClient<Database>, appId: string, name: string, data: Buffer, orgId: string): Promise<boolean> {
  try {
    const snag = useLogSnag()
    await snag.track({
      channel: 'app',
      event: 'App Multipart Prepare',
      icon: '⏫',
      user_id: orgId,
      tags: {
        'app-id': appId,
      },
      notify: false,
    }).catch()
    const multipartPrep = await prepareMultipart(supabase, appId, name)
    if (!multipartPrep) {
      // Just pass the error
      return false
    }

    const fileSize = data.length
    const partCount = Math.ceil(fileSize / PART_SIZE)

    const uploadPromises = Array.from({ length: partCount }, (_, index) =>
      uploadPart(data, PART_SIZE, multipartPrep.url, multipartPrep.key, multipartPrep.uploadId, index))

    const parts = await Promise.all(uploadPromises)

    await finishMultipartDownload(multipartPrep.key, multipartPrep.uploadId, multipartPrep.url, parts)

    await snag.track({
      channel: 'app',
      event: 'App Multipart done',
      icon: '⏫',
      user_id: orgId,
      tags: {
        'app-id': appId,
      },
      notify: false,
    }).catch()
    return true
  }
  catch (e) {
    log.error(`Could not upload via multipart ${formatError(e)}`)
    return false
  }
}

export async function deletedFailedVersion(supabase: SupabaseClient<Database>, appId: string, name: string): Promise<void> {
  const data = {
    app_id: appId,
    name,
  }
  try {
    const pathFailed = 'private/delete_failed_version'
    const res = await supabase.functions.invoke(pathFailed, { body: JSON.stringify(data), method: 'DELETE' })
    return res.data.status
  }
  catch (error) {
    log.error(`Cannot delete failed version ${formatError(error)}`)
    return Promise.reject(new Error('Cannot delete failed version'))
  }
}

async function uploadPart(
  data: Buffer,
  partsize: number,
  url: string,
  key: string,
  uploadId: string,
  index: number,
) {
  const dataToUpload = data.subarray(
    partsize * index,
    partsize * (index + 1),
  )

  const metadata = {
    action: 'mpu-uploadpart',
    uploadId,
    partNumber: index + 1,
    key,
  }

  const response = await ky.put(url, {
    body: dataToUpload,
    searchParams: new URLSearchParams({ body: btoa(JSON.stringify(metadata)) }),
  })

  return await response.json()
}

export async function updateOrCreateChannel(supabase: SupabaseClient<Database>, update: Database['public']['Tables']['channels']['Insert']) {
  // console.log('updateOrCreateChannel', update)
  if (!update.app_id || !update.name || !update.created_by) {
    log.error('missing app_id, name, or created_by')
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
      log.info('Progressive deploy is enabled')

      if (data.secondaryVersionPercentage !== 1)
        log.warn('Latest progressive deploy has not finished')

      update.secondVersion = update.version
      if (!data.secondVersion) {
        log.error('missing secondVersion')
        return Promise.reject(new Error('missing secondVersion'))
      }
      update.version = data.secondVersion
      update.secondaryVersionPercentage = 0.1
      log.info('Started new progressive upload!')

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
    token: env.CAPGO_LOGSNAG ?? 'c124f5e9d0ce5bdd14bbb48f815d5583',
    project: env.CAPGO_LOGSNAG_PROJECT ?? 'capgo',
  })
  return logsnag
}

export async function getOrganization(supabase: SupabaseClient<Database>, roles: string[]): Promise<Organization> {
  const { error: orgError, data: allOrganizations } = await supabase
    .rpc('get_orgs_v5')

  if (orgError) {
    log.error('Cannot get the list of organizations - exiting')
    log.error(`Error ${JSON.stringify(orgError)}`)
    program.error('')
  }

  const adminOrgs = allOrganizations.filter(org => !!roles.find(role => role === org.role))

  if (adminOrgs.length === 0) {
    log.error(`Could not get organization with roles: ${roles.join(' or ')} because the user does not have any org`)
    program.error('')
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
    program.error('')
  }

  const organizationUid = organizationUidRaw as string
  const organization = allOrganizations.find(org => org.gid === organizationUid)!

  log.info(`Using the organization "${organization.name}" as the app owner`)
  return organization
}

export const convertAppName = (appName: string) => appName.replace(/\./g, '--')

export async function verifyUser(supabase: SupabaseClient<Database>, apikey: string, keymod: Database['public']['Enums']['key_mode'][] = ['all']) {
  await checkKey(supabase, apikey, keymod)

  const { data: dataUser, error: userIdError } = await supabase
    .rpc('get_user_id', { apikey })
    .single()

  const userId = (dataUser || '').toString()

  if (!userId || userIdError) {
    log.error(`Cannot auth user with apikey`)
    program.error('')
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
    program.error('')
  }
  return data.owner_org
}

export async function requireUpdateMetadata(supabase: SupabaseClient<Database>, channel: string, appId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('channels')
    .select('disableAutoUpdate')
    .eq('name', channel)
    .eq('app_id', appId)
    .limit(1)

  if (error) {
    log.error(`Cannot check if disableAutoUpdate is required ${formatError(error)}`)
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

let pmFetched = false
let pm: PackageManagerType = 'npm'
let pmCommand: InstallCommand = 'install'
let pmRunner: PackageManagerRunner = 'npx'
export function getPMAndCommand() {
  if (pmFetched)
    return { pm, command: pmCommand, installCommand: `${pm} ${pmCommand}`, runner: pmRunner }
  const dir = findRootSync(cwd())
  pm = findPackageManagerType(dir.rootDir, 'npm')
  pmCommand = findInstallCommand(pm)
  pmFetched = true
  pmRunner = findPackageManagerRunner(dir.rootDir)
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

export async function getLocalDepenencies() {
  const dir = findRootSync(cwd())
  const packageJsonPath = join(cwd(), 'package.json')

  if (!existsSync(packageJsonPath)) {
    log.error('Missing package.json, you need to be in a capacitor project')
    program.error('')
  }

  let packageJson
  try {
    packageJson = await readPackageJson()
  }
  catch (err) {
    log.error('Invalid package.json, JSON parsing failed')
    console.error('json parse error: ', err)
    program.error('')
  }

  const { dependencies } = packageJson
  if (!dependencies) {
    log.error('Missing dependencies section in package.json')
    program.error('')
  }

  for (const [key, value] of Object.entries(dependencies)) {
    if (typeof value !== 'string') {
      log.error(`Invalid dependency ${key}: ${value}, expected string, got ${typeof value}`)
      program.error('')
    }
  }

  const nodeModulesPath = join(cwd(), 'node_modules')
  if (!existsSync(nodeModulesPath)) {
    const pm = findPackageManagerType(dir.rootDir, 'npm')
    const installCmd = findInstallCommand(pm)
    log.error(`Missing node_modules folder, please run ${pm} ${installCmd}`)
    program.error('')
  }

  let anyInvalid = false

  const dependenciesObject = await Promise.all(Object.entries(dependencies as Record<string, string>)
    .map(async ([key, value]) => {
      const dependencyFolderPath = join(nodeModulesPath, key)
      const dependencyFolderExists = existsSync(dependencyFolderPath)

      if (!dependencyFolderExists) {
        anyInvalid = true
        const pm = findPackageManagerType(dir.rootDir, 'npm')
        const installCmd = findInstallCommand(pm)
        log.error(`Missing dependency ${key}, please run ${pm} ${installCmd}`)
        return { name: key, version: value }
      }

      let hasNativeFiles = false
      try {
        const files = readDirRecursively(dependencyFolderPath)
        hasNativeFiles = files.some(fileName => nativeFileRegex.test(fileName))
      }
      catch (error) {
        log.error(`Error reading node_modules files for ${key} package`)
        console.error(error)
        program.error('')
      }

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
    log.error(`Error fetching native packages: ${error.message}`)
    program.error('')
  }

  let castedRemoteNativePackages
  try {
    castedRemoteNativePackages = (remoteNativePackages as any).version.native_packages
  }
  catch (err) {
    // If we do not do this we will get an unreadable
    log.error(`Error parsing native packages`)
    program.error('')
  }

  if (!castedRemoteNativePackages) {
    log.error(`Error parsing native packages, perhaps the metadata does not exist?`)
    program.error('')
  }

  // Check types
  castedRemoteNativePackages.forEach((data: any) => {
    if (typeof data !== 'object') {
      log.error(`Invalid remote native package data: ${data}, expected object, got ${typeof data}`)
      program.error('')
    }

    const { name, version } = data
    if (!name || typeof name !== 'string') {
      log.error(`Invalid remote native package name: ${name}, expected string, got ${typeof name}`)
      program.error('')
    }

    if (!version || typeof version !== 'string') {
      log.error(`Invalid remote native package version: ${version}, expected string, got ${typeof version}`)
      program.error('')
    }
  })

  const mappedRemoteNativePackages = new Map((castedRemoteNativePackages as { name: string, version: string }[])
    .map(a => [a.name, a]))

  return mappedRemoteNativePackages
}

export async function checkChecksum(supabase: SupabaseClient<Database>, appId: string, channel: string, currentChecksum: string) {
  const s = spinner()
  s.start(`Checking bundle checksum compatibility with channel ${channel}`)
  const remoteChecksum = await getRemoteChecksums(supabase, appId, channel)

  if (remoteChecksum && remoteChecksum === currentChecksum) {
    // cannot upload the same bundle
    log.error(`Cannot upload the same bundle content.\nCurrent bundle checksum matches remote bundle for channel ${channel}\nDid you builded your app before uploading ?`)
    program.error('')
  }
  s.stop(`Checksum compatible with ${channel} channel`)
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
