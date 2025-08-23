import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { createChannel, findUnknownVersion } from '../api/channels'
import { createSupabaseClient, findSavedKey, formatError, getAppId, getConfig, getOrganizationId, OrganizationPerm, sendEvent, verifyUser } from '../utils'

interface Options extends OptionsBase {
  default?: boolean
  selfAssign?: boolean
}

export async function addChannel(channelId: string, appId: string, options: Options, shouldExit = true) {
  intro(`Create channel`)
  try {
    options.apikey = options.apikey || findSavedKey()
    const extConfig = await getConfig().catch(() => undefined)
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

    await verifyUser(supabase, options.apikey, ['write', 'all'])
    // Check we have app access to this appId
    await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.admin)

    log.info(`Creating channel ${appId}#${channelId} to Capgo`)
    const data = await findUnknownVersion(supabase, appId)
    const orgId = await getOrganizationId(supabase, appId)
    const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])
    if (!data) {
      log.error(`Cannot find default version for channel creation, please contact Capgo support 🤨`)
      program.error('')
    }
    const res = await createChannel(supabase, {
      name: channelId,
      app_id: appId,
      version: data.id,
      created_by: userId,
      owner_org: orgId,
      allow_device_self_set: options.selfAssign ?? false,
      public: options.default ?? false,
    })

    if (res.error) {
      log.error(`Cannot create Channel 🙀\n${formatError(res.error)}`)
      program.error('')
    }

    log.success(`Channel created ✅`)
    await sendEvent(options.apikey, {
      channel: 'channel',
      event: 'Create channel',
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
    log.error(`Cannot create Channel 🙀 ${formatError(err)}`)
    return false
  }
  if (shouldExit) {
    outro(`Done ✅`)
    exit()
  }
  return true
}

export async function addChannelCommand(apikey: string, appId: string, options: Options) {
  addChannel(apikey, appId, options, true)
}
