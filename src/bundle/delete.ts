import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { deleteSpecificVersion } from '../api/versions'
import { createSupabaseClient, findSavedKey, formatError, getAppId, getConfig, OrganizationPerm, verifyUser } from '../utils'

interface Options extends OptionsBase {
  bundle: string
}

export async function deleteBundle(bundleId: string, appId: string, options: Options, shouldExit = true) {
  if (shouldExit)
    intro(`Delete bundle`)
  try {
    options.apikey = options.apikey || findSavedKey()
    const extConfig = await getConfig()
    appId = getAppId(appId, extConfig?.config)

    if (!options.apikey) {
      log.error('Missing API key, you need to provide an API key to upload your bundle')
      if (shouldExit)
        program.error('')
      throw new Error('Missing API key')
    }
    if (!appId) {
      log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
      if (shouldExit)
        program.error('')
      throw new Error('Missing appId')
    }
    const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)

    await verifyUser(supabase, options.apikey, ['write', 'all'])
    // Check we have app access to this appId
    await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.write)

    if (!bundleId) {
      log.error('Missing argument, you need to provide a bundleId, or be in a capacitor project')
      if (shouldExit)
        program.error('')
      throw new Error('Missing bundleId')
    }

    log.info(`Deleting bundle ${appId}@${bundleId} from Capgo`)
    log.info(`Keep in mind that you will not be able to reuse this bundle version, it's gone forever`)

    await deleteSpecificVersion(supabase, appId, bundleId)
    log.success(`Bundle ${appId}@${bundleId} deleted in Capgo`)
    if (shouldExit) {
      outro(`Done`)
      exit()
    }
    return true
  }
  catch (err) {
    log.error(`Error deleting bundle ${formatError(err)}`)
    if (shouldExit)
      program.error('')
    throw err
  }
}
