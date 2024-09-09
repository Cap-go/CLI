import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { createChannel, findUnknownVersion } from '../api/channels'
import { createSupabaseClient, findSavedKey, formatError, getConfig, getOrganizationId, OrganizationPerm, useLogSnag, verifyUser } from '../utils'
import type { OptionsBase } from '../utils'

interface Options extends OptionsBase {
  default?: boolean
}

export async function addChannel(channelId: string, appId: string, options: Options, shouldExit = true) {
  intro(`Create channel`)
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

  await verifyUser(supabase, options.apikey, ['write', 'all'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.admin)

  log.info(`Creating channel ${appId}#${channelId} to Capgo`)
  try {
    const data = await findUnknownVersion(supabase, appId)
    const orgId = await getOrganizationId(supabase, appId)
    if (!data) {
      log.error(`Cannot find default version for channel creation, please contact Capgo support 🤨`)
      program.error('')
    }
    const res = await createChannel(supabase, {
      name: channelId,
      app_id: appId,
      version: data.id,
      owner_org: orgId,
    })

    if (res.error) {
      log.error(`Cannot create Channel 🙀\n${formatError(res.error)}`)
      program.error('')
    }

    log.success(`Channel created ✅`)
    await snag.track({
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
  catch {
    log.error(`Cannot create Channel 🙀`)
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
