import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { displayChannels, getActiveChannels } from '../api/channels'
import { createSupabaseClient, findSavedKey, getAppId, getConfig, OrganizationPerm, sendEvent, verifyUser } from '../utils'

export async function listChannels(appId: string, options: OptionsBase, shouldExit = true) {
  if (shouldExit)
    intro(`List channels`)
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

    const userId = await verifyUser(supabase, options.apikey, ['write', 'all', 'read', 'upload'])
    // Check we have app access to this appId
    await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.read)

    log.info(`Querying available channels in Capgo`)

    // Get all active app versions we might possibly be able to cleanup
    const allVersions = await getActiveChannels(supabase, appId)

    log.info(`Active channels in Capgo: ${allVersions?.length}`)

    if (shouldExit)
      displayChannels(allVersions)

    await sendEvent(options.apikey, {
      channel: 'channel',
      event: 'List channel',
      icon: '✅',
      user_id: userId,
      tags: {
        'app-id': appId,
      },
      notify: false,
    }).catch()

    if (shouldExit) {
      outro(`Done ✅`)
      exit()
    }

    return allVersions
  }
  catch (err) {
    log.error(`Error listing channels`)
    if (shouldExit)
      program.error('')
    throw err
  }
}
