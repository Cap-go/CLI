import type { Buffer } from 'node:buffer'
import type { Options } from '../api/app'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { intro, log, outro } from '@clack/prompts'
import { checkAppExistsAndHasPermissionOrgErr, newIconPath } from '../api/app'
import {
  createSupabaseClient,
  findSavedKey,
  formatError,
  getAppId,
  getConfig,
  getContentType,
  getOrganization,
  OrganizationPerm,
  verifyUser,
} from '../utils'

export async function setApp(appId: string, options: Options, silent = false) {
  if (!silent)
    intro('Set app')

  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
  appId = getAppId(appId, extConfig?.config)

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

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
  const organization = await getOrganization(supabase, ['admin', 'super_admin'])
  const organizationUid = organization.gid

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])

  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.admin, silent)

  const { name, icon, retention } = options

  if (retention && Number.isNaN(Number(retention))) {
    if (!silent)
      log.error('retention value must be a number')
    throw new Error('Retention value must be a number')
  }
  else if (retention && retention < 0) {
    if (!silent)
      log.error('retention value cannot be less than 0')
    throw new Error('Retention value cannot be less than 0')
  }
  else if (retention && retention >= 63113904) {
    if (!silent)
      log.error('retention value cannot be greater than 63113904 seconds (2 years)')
    throw new Error('Retention value cannot be greater than 63113904 seconds (2 years)')
  }

  let iconBuff: Buffer | undefined
  let iconType: string | undefined
  const fileName = `icon_${randomUUID()}`
  let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'

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

  if (iconBuff && iconType) {
    const { error } = await supabase.storage
      .from(`images/org/${organizationUid}/${appId}`)
      .upload(fileName, iconBuff, { contentType: iconType })

    if (error) {
      if (!silent)
        log.error(`Could not set app ${formatError(error)}`)
      throw new Error(`Could not set app: ${formatError(error)}`)
    }

    const { data: signedURLData } = await supabase.storage
      .from(`images/org/${organizationUid}/${appId}`)
      .getPublicUrl(fileName)

    signedURL = signedURLData?.publicUrl || signedURL
  }

  const { error: dbError } = await supabase
    .from('apps')
    .update({
      icon_url: signedURL,
      name,
      retention: !retention ? undefined : retention * 24 * 60 * 60,
    })
    .eq('app_id', appId)
    .eq('user_id', userId)

  if (dbError) {
    if (!silent)
      log.error(`Could not set app ${formatError(dbError)}`)
    throw new Error(`Could not set app: ${formatError(dbError)}`)
  }

  if (!silent)
    outro('Done ✅')

  return true
}
