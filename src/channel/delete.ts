import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { delChannel, delChannelDevices, findBundleIdByChannelName, findChannel } from '../api/channels'
import { deleteAppVersion } from '../api/versions'
import { createSupabaseClient, findSavedKey, formatError, getAppId, getConfig, getOrganizationId, OrganizationPerm, sendEvent, verifyUser } from '../utils'

interface DeleteChannelOptions extends OptionsBase {
  deleteBundle: boolean
  successIfNotFound: boolean
}

export async function deleteChannel(channelId: string, appId: string, options: DeleteChannelOptions) {
  intro(`Delete channel`)
  try {
    options.apikey = options.apikey || findSavedKey()
    const extConfig = await getConfig()
    appId = getAppId(appId, extConfig?.config)

    if (!options.apikey) {
      log.error('Missing API key, you need to provide an API key to upload your bundle')
      program.error('')
    }
    if (!appId) {
      log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
      program.error('')
    }
    const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)

    const userId = await verifyUser(supabase, options.apikey, ['all'])
    // Check we have app access to this appId
    await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.admin)

    if (options.deleteBundle) {
      log.info(`Deleting bundle ${appId}#${channelId} from Capgo`)
      // first get the bundle id
      const bundle = await findBundleIdByChannelName(supabase, appId, channelId)
      if (bundle && bundle.name) {
        log.info(`Deleting bundle ${bundle.name} from Capgo`)
        await deleteAppVersion(supabase, appId, bundle.name)
      }
    }
    // check if channel exists
    const { data: channel, error: channelError } = await findChannel(supabase, appId, channelId)
    if (channelError || !channel) {
      log.error(`Channel ${channelId} not found`)
      if (options.successIfNotFound) {
        log.success(`Channel ${channelId} not found and successIfNotFound is true`)
        exit()
      }
      program.error('')
    }

    // delete any devices assigned to this channel
    const { error: delDevicesError } = await delChannelDevices(supabase, appId, channel.id)
    if (delDevicesError) {
      log.error(`Cannot delete channel devices: ${formatError(delDevicesError)}`)
      program.error('')
    }

    log.info(`Deleting channel ${appId}#${channelId} from Capgo`)
    const deleteStatus = await delChannel(supabase, channelId, appId, userId)
    if (deleteStatus.error) {
      log.error(`Cannot delete Channel 🙀 ${formatError(deleteStatus.error)}`)
      program.error('')
    }
    const orgId = await getOrganizationId(supabase, appId)
    log.success(`Channel deleted`)
    await sendEvent(options.apikey, {
      channel: 'channel',
      event: 'Delete channel',
      icon: '✅',
      user_id: orgId,
      tags: {
        'app-id': appId,
        'channel': channelId,
      },
      notify: false,
    }).catch()
  }
  catch (err) {
    log.error(`Cannot delete Channel 🙀 ${formatError(err)}`)
  }
  outro(`Done ✅`)
  exit()
}
