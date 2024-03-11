import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import mime from 'mime'
import { program } from 'commander'
import * as p from '@clack/prompts'
import type { Options } from '../api/app'
import { checkAppExistsAndHasPermissionErr, newIconPath } from '../api/app'
import { createSupabaseClient, findSavedKey, formatError, getConfig, verifyUser } from '../utils'

export async function setApp(appId: string, options: Options) {
  p.intro(`Set app`)
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig()
  appId = appId || config?.app?.appId

  if (!options.apikey) {
    p.log.error(`Missing API key, you need to provide a API key to upload your bundle`)
    program.error(``)
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error(``)
  }
  const supabase = await createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionErr(supabase, options.apikey, appId)

  const { name, icon, retention } = options

  if (retention && !Number.isNaN(Number(retention))) {
    p.log.error(`retention value must be a number`)
    program.error(``)
  }
  else if (retention && retention < 0) {
    p.log.error(`retention value cannot be less than 0`)
    program.error(``)
  }

  let iconBuff
  let iconType
  const fileName = `icon_${randomUUID()}`
  let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'

  if (icon && existsSync(icon)) {
    iconBuff = readFileSync(icon)
    const contentType = mime.getType(icon)
    iconType = contentType || 'image/png'
    p.log.warn(`Found app icon ${icon}`)
  }
  else if (existsSync(newIconPath)) {
    iconBuff = readFileSync(newIconPath)
    const contentType = mime.getType(newIconPath)
    iconType = contentType || 'image/png'
    p.log.warn(`Found app icon ${newIconPath}`)
  }
  else {
    p.log.warn(`Cannot find app icon in any of the following locations: ${icon}, ${newIconPath}`)
  }
  if (iconBuff && iconType) {
    const { error } = await supabase.storage
      .from(`images/${userId}/${appId}`)
      .upload(fileName, iconBuff, {
        contentType: iconType,
      })
    if (error) {
      p.log.error(`Could not set app ${formatError(error)}`)
      program.error(``)
    }
    const { data: signedURLData } = await supabase
      .storage
      .from(`images/${userId}/${appId}`)
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
    p.log.error(`Could not set app ${formatError(dbError)}`)
    program.error(``)
  }
  p.outro(`Done ✅`)
  process.exit()
}
