import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import mime from 'mime'
import { program } from 'commander'
import * as p from '@clack/prompts'
import { checkLatest } from '../api/update'
import type { Options } from '../api/app'
import { checkAppExists, newIconPath } from '../api/app'
import {
  checkPlanValid,
  createSupabaseClient,
  findSavedKey,
  formatError,
  getConfig,
  useLogSnag,
  verifyUser,
} from '../utils'

export async function addApp(appId: string, options: Options, throwErr = true) {
  if (throwErr)
    p.intro(`Adding`)

  await checkLatest()
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig()
  appId = appId || config?.app?.appId
  const snag = useLogSnag()

  if (!options.apikey) {
    p.log.error(`Missing API key, you need to provide a API key to upload your bundle`)
    program.error('')
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }

  if (appId.includes('--')) {
    p.log.error('The app id includes illegal symbols. You cannot use "--" in the app id')
    program.error('')
  }

  const supabase = await createSupabaseClient(options.apikey)

  let userId = await verifyUser(supabase, options.apikey, ['write', 'all'])

  // Check we have app access to this appId
  const appExist = await checkAppExists(supabase, appId)
  if (throwErr && appExist) {
    p.log.error(`App ${appId} already exist`)
    program.error('')
  }
  else if (appExist) {
    return true
  }

  const { error: orgError, data: allOrganizations } = await supabase
    .rpc('get_orgs_v5')

  if (orgError) {
    p.log.error('Cannot get the list of organizations - exiting')
    p.log.error(`Error ${JSON.stringify(orgError)}`)
    program.error('')
  }

  const adminOrgs = allOrganizations.filter(org => org.role === 'admin' || org.role === 'super_admin')

  const organizationUidRaw = (adminOrgs.length > 1)
    ? await p.select({
      message: 'Please pick the organization that you want to insert to',
      options: adminOrgs.map((org) => {
        return { value: org.gid, label: org.name }
      }),
    })
    : adminOrgs[0].gid

  if (p.isCancel(organizationUidRaw)) {
    p.log.error('Canceled organization selection, exiting')
    program.error('')
  }

  const organizationUid = organizationUidRaw as string
  const organization = allOrganizations.find(org => org.gid === organizationUid)!
  userId = organization.created_by

  p.log.info(`Using the organization "${organization.name}" as the app owner`)

  await checkPlanValid(supabase, organizationUid, options.apikey, undefined, false)

  let { name, icon } = options
  appId = appId || config?.app?.appId
  name = name || config?.app?.appName || 'Unknown'
  icon = icon || 'resources/icon.png' // default path for capacitor app
  if (!icon || !name) {
    p.log.error('Missing argument, you need to provide a appId and a name, or be in a capacitor project')
    program.error('')
  }
  if (throwErr)
    p.log.info(`Adding ${appId} to Capgo`)

  let iconBuff
  let iconType

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

  const fileName = `icon_${randomUUID()}`
  let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'

  // upload image if available
  if (iconBuff && iconType) {
    const { error } = await supabase.storage
      .from(`images/${userId}/${appId}`)
      .upload(fileName, iconBuff, {
        contentType: iconType,
      })
    if (error) {
      p.log.error(`Could not add app ${formatError(error)}`)
      program.error('')
    }
    const { data: signedURLData } = await supabase
      .storage
      .from(`images/${userId}/${appId}`)
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
    p.log.error(`Could not add app ${formatError(dbError)}`)
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
    p.log.error(`Could not add app ${formatError(dbVersionError)}`)
    program.error('')
  }
  await snag.track({
    channel: 'app',
    event: 'App Added',
    icon: '🎉',
    user_id: userId,
    tags: {
      'app-id': appId,
    },
    notify: false,
  }).catch()
  p.log.success(`App ${appId} added to Capgo. ${throwErr ? 'You can upload a bundle now' : ''}`)
  if (throwErr) {
    p.outro(`Done ✅`)
    process.exit()
  }
  return true
}

export async function addCommand(apikey: string, options: Options) {
  addApp(apikey, options, true)
}
