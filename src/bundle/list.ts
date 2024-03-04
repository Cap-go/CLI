import process from 'node:process'
import { program } from 'commander'
import * as p from '@clack/prompts'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { displayBundles, getActiveAppVersions } from '../api/versions'
import type { OptionsBase } from '../utils'
import { OrganizationPerm, createSupabaseClient, findSavedKey, getConfig, verifyUser } from '../utils'
import { checkLatest } from '../api/update'

export async function listBundle(appId: string, options: OptionsBase) {
  p.intro(`List bundles`)
  await checkLatest()
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig()

  appId = appId || config?.app?.appId
  if (!options.apikey) {
    p.log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appid, or be in a capacitor project')
    program.error('')
  }

  const supabase = await createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all', 'read', 'upload'])

  p.log.info(`Querying available versions of: ${appId} in Capgo`)

  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.read)

  // Get all active app versions we might possibly be able to cleanup
  const allVersions = await getActiveAppVersions(supabase, appId, userId)

  p.log.info(`Active versions in Capgo: ${allVersions?.length}`)

  displayBundles(allVersions)
  p.outro(`Done ✅`)
  process.exit()
}
