import type { Options } from '../api/app'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr, newIconPath } from '../api/app'
import { createSupabaseClient, findSavedKey, formatError, getAppId, getConfig, getContentType, getOrganization, OrganizationPerm, verifyUser } from '../utils'

export async function setApp(appId: string, options: Options) {
  intro(`Set app`)
  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
  appId = getAppId(appId, extConfig?.config)

  if (!options.apikey) {
    log.error(`Missing API key, you need to provide an API key to upload your bundle`)
    program.error(``)
  }
  if (!appId) {
    log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error(``)
  }
  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
  const organization = await getOrganization(supabase, ['admin', 'super_admin'])
  const organizationUid = organization.gid

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.admin)

  const { name, icon, retention } = options

  if (retention && Number.isNaN(Number(retention))) {
    log.error(`retention value must be a number`)
    program.error(``)
  }
  else if (retention && retention < 0) {
    log.error(`retention value cannot be less than 0`)
    program.error(``)
  }
  else if (retention && retention >= 63113904) {
    log.error(`retention value cannot be greater than 63113904 seconds (2 years)`)
    program.error(``)
  }

  let iconBuff
  let iconType
  const fileName = `icon_${randomUUID()}`
  let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'

  if (icon && existsSync(icon)) {
    iconBuff = readFileSync(icon)
    const contentType = getContentType(icon)
    iconType = contentType || 'image/png'
    log.warn(`Found app icon ${icon}`)
  }
  else if (existsSync(newIconPath)) {
    iconBuff = readFileSync(newIconPath)
    const contentType = getContentType(newIconPath)
    iconType = contentType || 'image/png'
    log.warn(`Found app icon ${newIconPath}`)
  }
  else {
    log.warn(`Cannot find app icon in any of the following locations: ${icon}, ${newIconPath}`)
  }
  if (iconBuff && iconType) {
    const { error } = await supabase.storage
      .from(`images/org/${organizationUid}/${appId}`)
      .upload(fileName, iconBuff, {
        contentType: iconType,
      })
    if (error) {
      log.error(`Could not set app ${formatError(error)}`)
      program.error(``)
    }
    const { data: signedURLData } = await supabase
      .storage
      .from(`images/org/${organizationUid}/${appId}`)
      .getPublicUrl(fileName)
    signedURL = signedURLData?.publicUrl || signedURL
  }
  // retention is in seconds in the database but received as days here
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
    log.error(`Could not set app ${formatError(dbError)}`)
    program.error(``)
  }
  outro(`Done ✅`)
  exit()
}
