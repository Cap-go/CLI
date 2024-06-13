import process from 'node:process'
import { program } from 'commander'
import * as p from '@clack/prompts'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import type { OptionsBase } from '../utils'
import { OrganizationPerm, createSupabaseClient, findSavedKey, getConfig, verifyUser } from '../utils'
import { deleteSpecificVersion } from '../api/versions'

interface Options extends OptionsBase {
  bundle: string
}

export async function deleteBundle(bundleId: string, appId: string, options: Options) {
  p.intro(`Delete bundle`)
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig()
  appId = appId || config?.app?.appId

  if (!options.apikey) {
    p.log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }
  const supabase = await createSupabaseClient(options.apikey)

  await verifyUser(supabase, options.apikey, ['write', 'all'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.write)

  appId = appId || config?.app?.appId
  if (!options.apikey) {
    p.log.error('Missing API key, you need to provide an API key to delete your app')
    program.error('')
  }
  if (!bundleId) {
    p.log.error('Missing argument, you need to provide a bundleId, or be in a capacitor project')
    program.error('')
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }

  p.log.info(`Deleting bundle ${appId}@${bundleId} from Capgo`)

  await deleteSpecificVersion(supabase, appId, bundleId)
  p.log.success(`Bundle ${appId}@${bundleId} deleted in Capgo`)
  p.outro(`Done`)
  process.exit()
}
