import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { checkAlerts } from '../api/update'
import { displayBundles, getActiveAppVersions } from '../api/versions'
import { createSupabaseClient, findSavedKey, getAppId, getConfig, OrganizationPerm, verifyUser } from '../utils'

export async function listBundle(appId: string, options: OptionsBase) {
  intro(`List bundles`)
  await checkAlerts()
  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
  appId = getAppId(appId, extConfig?.config)
  if (!options.apikey) {
    log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    log.error('Missing argument, you need to provide a appid, or be in a capacitor project')
    program.error('')
  }

  const supabase = await createSupabaseClient(options.apikey)

  await verifyUser(supabase, options.apikey, ['write', 'all', 'read', 'upload'])

  log.info(`Querying available versions of: ${appId} in Capgo`)

  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.read)

  // Get all active app versions we might possibly be able to cleanup
  const allVersions = await getActiveAppVersions(supabase, appId)

  log.info(`Active versions in Capgo: ${allVersions?.length}`)

  displayBundles(allVersions)
  outro(`Done ✅`)
  exit()
}
