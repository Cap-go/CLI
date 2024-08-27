import { exit } from 'node:process'
import { program } from 'commander'
import { intro, log, outro } from '@clack/prompts'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { delChannel } from '../api/channels'
import type { OptionsBase } from '../utils'
import { OrganizationPerm, createSupabaseClient, findSavedKey, formatError, getConfig, getOrganizationId, useLogSnag, verifyUser } from '../utils'

export async function deleteChannel(channelId: string, appId: string, options: OptionsBase) {
  intro(`Delete channel`)
  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
  appId = appId || extConfig?.config?.appId
  const snag = useLogSnag()

  if (!options.apikey) {
    log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }
  const supabase = await createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.admin)

  log.info(`Deleting channel ${appId}#${channelId} from Capgo`)
  try {
    const deleteStatus = await delChannel(supabase, channelId, appId, userId)
    if (deleteStatus.error) {
      log.error(`Cannot delete Channel 🙀 ${formatError(deleteStatus.error)}`)
      program.error('')
    }
    const orgId = await getOrganizationId(supabase, appId)
    log.success(`Channel deleted`)
    await snag.track({
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
  catch {
    log.error(`Cannot delete Channel 🙀`)
  }
  outro(`Done ✅`)
  exit()
}
