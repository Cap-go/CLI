import { existsSync, readFileSync } from 'node:fs'
import { exit } from 'node:process'
import mime from 'mime'
import { program } from 'commander'
import { intro, log, outro } from '@clack/prompts'
import { checkLatest } from '../api/update'
import type { Options } from '../api/app'
import { checkAppExists, newIconPath } from '../api/app'
import type {
  Organization,
} from '../utils'
import {
  checkPlanValid,
  createSupabaseClient,
  findSavedKey,
  formatError,
  getConfig,
  getOrganization,
  verifyUser,
} from '../utils'

export async function addApp(appId: string, options: Options, throwErr = true) {
  await addAppInternal(appId, options, undefined, throwErr)
}

export async function addAppInternal(appId: string, options: Options, organization?: Organization, throwErr = true) {
  if (throwErr)
    intro(`Adding`)

  await checkLatest()
  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
  appId = appId || extConfig?.config?.appId

  if (!options.apikey) {
    log.error(`Missing API key, you need to provide a API key to upload your bundle`)
    program.error('')
  }
  if (!appId) {
    log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }

  if (appId.includes('--')) {
    log.error('The app id includes illegal symbols. You cannot use "--" in the app id')
    program.error('')
  }

  const supabase = await createSupabaseClient(options.apikey)

  await verifyUser(supabase, options.apikey, ['write', 'all'])

  // Check we have app access to this appId
  const appExist = await checkAppExists(supabase, appId)
  if (appExist) {
    log.error(`App ${appId} already exist`)
    program.error('')
  }

  if (!organization)
    organization = await getOrganization(supabase, ['admin', 'super_admin'])

  const organizationUid = organization.gid

  await checkPlanValid(supabase, organizationUid, options.apikey, undefined, false)

  let { name, icon } = options
  name = name || extConfig.config?.appName || 'Unknown'
  icon = icon || 'resources/icon.png' // default path for capacitor app
  if (!icon || !name) {
    log.error('Missing argument, you need to provide a appId and a name, or be in a capacitor project')
    program.error('')
  }
  if (throwErr)
    log.info(`Adding ${appId} to Capgo`)

  let iconBuff
  let iconType

  if (icon && existsSync(icon)) {
    iconBuff = readFileSync(icon)
    const contentType = mime.getType(icon)
    iconType = contentType || 'image/png'
    log.warn(`Found app icon ${icon}`)
  }
  else if (existsSync(newIconPath)) {
    iconBuff = readFileSync(newIconPath)
    const contentType = mime.getType(newIconPath)
    iconType = contentType || 'image/png'
    log.warn(`Found app icon ${newIconPath}`)
  }
  else {
    log.warn(`Cannot find app icon in any of the following locations: ${icon}, ${newIconPath}`)
  }

  const fileName = `icon`
  let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'

  // upload image if available
  if (iconBuff && iconType) {
    const { error } = await supabase.storage
      .from(`images/org/${organizationUid}/${appId}`)
      .upload(fileName, iconBuff, {
        contentType: iconType,
      })
    if (error) {
      console.error(error)
      log.error(`Could not add app ${formatError(error)}`)
      program.error('')
    }
    const { data: signedURLData } = await supabase
      .storage
      .from(`images/org/${organizationUid}/${appId}`)
      .getPublicUrl(fileName)
    signedURL = signedURLData?.publicUrl || signedURL
  }
  // add app to db
  const { error: dbError } = await supabase
    .from('apps')
    .insert({
      icon_url: signedURL,
      owner_org: organizationUid,
      name,
      app_id: appId,
    })
  if (dbError) {
    log.error(`Could not add app ${formatError(dbError)}`)
    program.error('')
  }
  const { error: dbVersionError } = await supabase
    .from('app_versions')
    .insert([{
      owner_org: organizationUid,
      deleted: true,
      name: 'unknown',
      app_id: appId,
    }, {
      owner_org: organizationUid,
      deleted: true,
      name: 'builtin',
      app_id: appId,
    }])
  if (dbVersionError) {
    log.error(`Could not add app ${formatError(dbVersionError)}`)
    program.error('')
  }
  log.success(`App ${appId} added to Capgo. ${throwErr ? 'You can upload a bundle now' : ''}`)
  if (throwErr) {
    outro(`Done ✅`)
    exit()
  }
  return true
}

export async function addCommand(apikey: string, options: Options) {
  addApp(apikey, options, true)
}
