import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { delChannel, findBundleIdByChannelName } from '../api/channels'
import { deleteAppVersion } from '../api/versions'
import { createSupabaseClient, findSavedKey, formatError, getAppId, getConfig, getOrganizationId, OrganizationPerm, sendEvent, verifyUser } from '../utils'

interface DeleteChannelOptions extends OptionsBase {
  deleteBundle: boolean
}

export async function deleteChannel(channelId: string, appId: string, options: DeleteChannelOptions) {
  intro(`Delete channel`)
  try {
    options.apikey = options.apikey || findSavedKey()
    const extConfig = await getConfig()
    appId = getAppId(appId, extConfig?.config)

    if (!options.apikey) {
      log.error('Missing API key, you need to provide a API key to upload your bundle')
      program.error('')
    }
    if (!appId) {
      log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
      program.error('')
    }
    const supabase = await createSupabaseClient(options.apikey)

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
        'user-id': userId,
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
