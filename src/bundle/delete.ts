import type { OptionsBase } from '../utils'
import { intro, log, outro } from '@clack/prompts'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { deleteSpecificVersion } from '../api/versions'
import { createSupabaseClient, findSavedKey, getAppId, getConfig, OrganizationPerm, verifyUser } from '../utils'

interface Options extends OptionsBase {
  bundle: string
}

export async function deleteBundle(bundleId: string, appId: string, options: Options, silent = false) {
  if (!silent)
    intro('Delete bundle')

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

  if (!bundleId) {
    if (!silent)
      log.error('Missing argument, you need to provide a bundleId, or be in a capacitor project')
    throw new Error('Missing bundleId')
  }

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)

  await verifyUser(supabase, options.apikey, ['write', 'all'])
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.write)

  if (!silent) {
    log.info(`Deleting bundle ${appId}@${bundleId} from Capgo`)
    log.info(`Keep in mind that you will not be able to reuse this bundle version, it's gone forever`)
  }

  await deleteSpecificVersion(supabase, appId, bundleId)

  if (!silent) {
    log.success(`Bundle ${appId}@${bundleId} deleted in Capgo`)
    outro('Done')
  }

  return true
}
