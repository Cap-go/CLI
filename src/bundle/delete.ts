import { exit } from 'node:process'
import { program } from 'commander'
import { intro, log, outro } from '@clack/prompts'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import type { OptionsBase } from '../utils'
import { OrganizationPerm, createSupabaseClient, findSavedKey, getConfig, verifyUser } from '../utils'
import { deleteSpecificVersion } from '../api/versions'

interface Options extends OptionsBase {
  bundle: string
}

export async function deleteBundle(bundleId: string, appId: string, options: Options) {
  intro(`Delete bundle`)
  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
  appId = appId || extConfig?.config?.appId

  if (!options.apikey) {
    log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }
  const supabase = await createSupabaseClient(options.apikey)

  await verifyUser(supabase, options.apikey, ['write', 'all'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.write)

  if (!options.apikey) {
    log.error('Missing API key, you need to provide an API key to delete your app')
    program.error('')
  }
  if (!bundleId) {
    log.error('Missing argument, you need to provide a bundleId, or be in a capacitor project')
    program.error('')
  }
  if (!appId) {
    log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }

  log.info(`Deleting bundle ${appId}@${bundleId} from Capgo`)

  await deleteSpecificVersion(supabase, appId, bundleId)
  log.success(`Bundle ${appId}@${bundleId} deleted in Capgo`)
  outro(`Done`)
  exit()
}
