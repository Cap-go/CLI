import type { OptionsBase } from '../utils'
import { intro, log, outro } from '@clack/prompts'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { createChannel, findUnknownVersion } from '../api/channels'
import {
  createSupabaseClient,
  findSavedKey,
  formatError,
  getAppId,
  getConfig,
  getOrganizationId,
  OrganizationPerm,
  sendEvent,
  verifyUser,
} from '../utils'

interface Options extends OptionsBase {
  default?: boolean
  selfAssign?: boolean
}

export async function addChannelInternal(channelId: string, appId: string, options: Options, silent = false) {
  if (!silent)
    intro('Create channel')

  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig().catch(() => undefined)
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

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)

  await verifyUser(supabase, options.apikey, ['write', 'all'])
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.admin, silent)

  if (!silent)
    log.info(`Creating channel ${appId}#${channelId} to Capgo`)

  const data = await findUnknownVersion(supabase, appId)
  if (!data) {
    if (!silent)
      log.error('Cannot find default version for channel creation, please contact Capgo support 🤨')
    throw new Error('Cannot find default version for channel creation')
  }

  const orgId = await getOrganizationId(supabase, appId)
  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])

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
    if (!silent)
      log.error(`Cannot create Channel 🙀\n${formatError(res.error)}`)
    throw new Error(`Cannot create channel: ${formatError(res.error)}`)
  }

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
  }).catch(() => {})

  if (!silent) {
    log.success('Channel created ✅')
    outro('Done ✅')
  }

  return res.data ?? true
}

export async function addChannel(channelId: string, appId: string, options: Options) {
  await addChannelInternal(channelId, appId, options, false)
}
