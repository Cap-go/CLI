import type { SupabaseClient } from '@supabase/supabase-js'
import type { Buffer } from 'node:buffer'
import type { Options } from '../api/app'
import type { Database } from '../types/supabase.types'
import type { Organization } from '../utils'
import { existsSync, readFileSync } from 'node:fs'
import { intro, log, outro } from '@clack/prompts'
import { checkAppExists, newIconPath } from '../api/app'
import { checkAlerts } from '../api/update'
import {
  createSupabaseClient,
  findSavedKey,
  formatError,
  getAppId,
  getConfig,
  getContentType,
  getOrganization,
  verifyUser,
} from '../utils'

function ensureOptions(appId: string, options: Options, silent: boolean) {
  if (!options.apikey) {
    if (!silent)
      log.error('Missing API key, you need to provide an API key to upload your bundle')
    throw new Error('Missing API key')
  }

  if (!appId) {
    if (!silent)
      log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    throw new Error('Missing appId')
  }

  if (appId.includes('--')) {
    if (!silent)
      log.error('The app id includes illegal symbols. You cannot use "--" in the app id')
    throw new Error('App id includes illegal symbols')
  }
}

async function ensureAppDoesNotExist(
  supabase: SupabaseClient<Database>,
  appId: string,
  silent: boolean,
) {
  const appExist = await checkAppExists(supabase, appId)
  if (!appExist)
    return

  if (appId === 'io.ionic.starter') {
    if (!silent)
      log.error(`This appId ${appId} cannot be used it's reserved, please change it in your capacitor config.`)
    throw new Error('Reserved appId, please change it in capacitor config')
  }

  if (!silent)
    log.error(`App ${appId} already exist`)
  throw new Error(`App ${appId} already exists`)
}

export async function addApp(appId: string, options: Options, silent = false) {
  return addAppInternal(appId, options, undefined, silent)
}

export async function addAppInternal(
  initialAppId: string,
  options: Options,
  organization?: Organization,
  silent = false,
) {
  if (!silent)
    intro('Adding')

  await checkAlerts()

  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
  const appId = getAppId(initialAppId, extConfig?.config)

  ensureOptions(appId, options, silent)

  const supabase = await createSupabaseClient(options.apikey!, options.supaHost, options.supaAnon)
  const userId = await verifyUser(supabase, options.apikey!, ['write', 'all'])

  await ensureAppDoesNotExist(supabase, appId, silent)

  if (!organization)
    organization = await getOrganization(supabase, ['admin', 'super_admin'])

  const organizationUid = organization.gid

  let { name, icon } = options
  name = name || extConfig.config?.appName || 'Unknown'
  icon = icon || 'resources/icon.png'

  if (!icon || !name) {
    if (!silent)
      log.error('Missing argument, you need to provide a appId and a name, or be in a capacitor project')
    throw new Error('Missing app name or icon path')
  }

  if (!silent)
    log.info(`Adding ${appId} to Capgo`)

  let iconBuff: Buffer | null = null
  let iconType: string | null = null

  if (icon && existsSync(icon)) {
    iconBuff = readFileSync(icon)
    const contentType = getContentType(icon)
    iconType = contentType || 'image/png'
    if (!silent)
      log.warn(`Found app icon ${icon}`)
  }
  else if (existsSync(newIconPath)) {
    iconBuff = readFileSync(newIconPath)
    const contentType = getContentType(newIconPath)
    iconType = contentType || 'image/png'
    if (!silent)
      log.warn(`Found app icon ${newIconPath}`)
  }
  else if (!silent) {
    log.warn(`Cannot find app icon in any of the following locations: ${icon}, ${newIconPath}`)
  }

  const fileName = 'icon'
  let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'

  if (iconBuff && iconType) {
    const { error } = await supabase.storage
      .from(`images/org/${organizationUid}/${appId}`)
      .upload(fileName, iconBuff, { contentType: iconType })

    if (error) {
      if (!silent)
        console.error(error)
      if (!silent)
        log.error(`Could not add app ${formatError(error)}`)
      throw new Error(`Could not add app ${formatError(error)}`)
    }

    const { data: signedURLData } = await supabase.storage
      .from(`images/org/${organizationUid}/${appId}`)
      .getPublicUrl(fileName)

    signedURL = signedURLData?.publicUrl || signedURL
  }

  const { error: dbError } = await supabase
    .from('apps')
    .insert({
      icon_url: signedURL,
      owner_org: organizationUid,
      user_id: userId,
      name,
      app_id: appId,
    })

  if (dbError) {
    if (!silent)
      log.error(`Could not add app ${formatError(dbError)}`)
    throw new Error(`Could not add app ${formatError(dbError)}`)
  }

  const { error: dbVersionError } = await supabase
    .from('app_versions')
    .insert([
      {
        owner_org: organizationUid,
        deleted: true,
        name: 'unknown',
        app_id: appId,
      },
      {
        owner_org: organizationUid,
        deleted: true,
        name: 'builtin',
        app_id: appId,
      },
    ])

  if (dbVersionError) {
    if (!silent)
      log.error(`Could not add app ${formatError(dbVersionError)}`)
    throw new Error(`Could not add app ${formatError(dbVersionError)}`)
  }

  if (!silent) {
    log.success(`App ${appId} added to Capgo. You can upload a bundle now`)
    outro('Done ✅')
  }

  return {
    appId,
    organizationUid,
    userId,
    name,
    signedURL,
  }
}

export async function addCommand(appId: string, options: Options) {
  await addApp(appId, options, false)
}
