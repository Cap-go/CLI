import type { Database } from '../types/supabase.types'
import type {
  OptionsBase,
} from '../utils'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import {
  checkPlanValid,
  createSupabaseClient,
  findSavedKey,
  formatError,
  getAppId,
  getBundleVersion,
  getConfig,
  getOrganizationId,
  OrganizationPerm,
  sendEvent,
  updateOrCreateChannel,
  verifyUser,
} from '../utils'

interface Options extends OptionsBase {
  bundle: string
  state?: string
  downgrade?: boolean
  latest?: boolean
  latestRemote?: boolean
  ios?: boolean
  android?: boolean
  selfAssign?: boolean
  disableAutoUpdate: string
  dev?: boolean
  emulator?: boolean
  packageJson?: string
}

const disableAutoUpdatesPossibleOptions = ['major', 'minor', 'metadata', 'patch', 'none']

export async function setChannel(channel: string, appId: string, options: Options) {
  intro(`Set channel`)
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

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.admin)
  const orgId = await getOrganizationId(supabase, appId)

  const { bundle, state, downgrade, latest, latestRemote, ios, android, selfAssign, disableAutoUpdate, dev, emulator } = options
  if (!channel) {
    log.error('Missing argument, you need to provide a channel')
    program.error('')
  }
  if (latest && bundle) {
    log.error('Cannot set latest and bundle at the same time')
    program.error('')
  }
  if (latestRemote && bundle) {
    log.error('Cannot set latest remote and bundle at the same time')
    program.error('')
  }
  if (latestRemote && latest) {
    log.error('Cannot set latest remote and latest at the same time')
    program.error('')
  }
  if (bundle == null
    && state == null
    && latest == null
    && latestRemote == null
    && downgrade == null
    && ios == null
    && android == null
    && selfAssign == null
    && dev == null
    && emulator == null
    && disableAutoUpdate == null) {
    log.error('Missing argument, you need to provide a option to set')
    program.error('')
  }
  try {
    await checkPlanValid(supabase, orgId, options.apikey, appId)
    const channelPayload: Database['public']['Tables']['channels']['Insert'] = {
      created_by: userId,
      app_id: appId,
      name: channel,
      owner_org: orgId,
      version: undefined as any,
    }
    // check if channel already exists
    const { error: channelError } = await supabase
      .from('channels')
      .select()
      .eq('app_id', appId)
      .eq('name', channel)
      .single()
    if (channelError) {
      log.error(`Cannot find channel ${channel}`)
      program.error('')
    }

    const bundleVersion = latest ? (extConfig?.config?.plugins?.CapacitorUpdater?.version || getBundleVersion('', options.packageJson)) : bundle
    if (bundleVersion != null) {
      const { data, error: vError } = await supabase
        .from('app_versions')
        .select()
        .eq('app_id', appId)
        .eq('name', bundleVersion)
        .eq('user_id', userId)
        .eq('deleted', false)
        .single()
      if (vError || !data) {
        log.error(`Cannot find version ${bundleVersion}`)
        program.error('')
      }
      log.info(`Set ${appId} channel: ${channel} to @${bundleVersion}`)
      channelPayload.version = data.id
    }
    if (latestRemote) {
      const { data, error: vError } = await supabase
        .from('app_versions')
        .select()
        .eq('app_id', appId)
        .eq('user_id', userId)
        .eq('deleted', false)
        .order('created_at', { ascending: false })
        .single()
      if (vError || !data) {
        log.error(`Cannot find latest remote version`)
        program.error('')
      }
      log.info(`Set ${appId} channel: ${channel} to @${data.name}`)
      channelPayload.version = data.id
    }
    if (state != null) {
      if (state !== 'normal' && state !== 'default') {
        log.error(`State ${state} is not known. The possible values are: normal, default.`)
        program.error('')
      }

      log.info(`Set ${appId} channel: ${channel} to ${state}`)
      channelPayload.public = state === 'default'
    }
    if (downgrade != null) {
      log.info(`Set ${appId} channel: ${channel} to ${downgrade ? 'allow' : 'disallow'} downgrade`)
      channelPayload.disable_auto_update_under_native = !downgrade
    }
    if (ios != null) {
      log.info(`Set ${appId} channel: ${channel} to ${ios ? 'allow' : 'disallow'} ios update`)
      channelPayload.ios = !!ios
    }
    if (android != null) {
      log.info(`Set ${appId} channel: ${channel} to ${android ? 'allow' : 'disallow'} android update`)
      channelPayload.android = !!android
    }
    if (selfAssign != null) {
      log.info(`Set ${appId} channel: ${channel} to ${selfAssign ? 'allow' : 'disallow'} self assign to this channel`)
      channelPayload.allow_device_self_set = !!selfAssign
    }
    if (dev != null) {
      log.info(`Set ${appId} channel: ${channel} to ${dev ? 'allow' : 'disallow'} dev devices`)
      channelPayload.allow_dev = !!dev
    }
    if (emulator != null) {
      log.info(`Set ${appId} channel: ${channel} to ${emulator ? 'allow' : 'disallow'} emulator devices`)
      channelPayload.allow_emulator = !!emulator
    }
    if (disableAutoUpdate != null) {
      let finalDisableAutoUpdate = disableAutoUpdate.toLocaleLowerCase()

      // The user passed an unimplemented strategy
      if (!disableAutoUpdatesPossibleOptions.includes(finalDisableAutoUpdate)) {
        log.error(`Channel strategy ${finalDisableAutoUpdate} is not known. The possible values are: ${disableAutoUpdatesPossibleOptions.join(', ')}.`)
        program.error('')
      }

      // This metadata is called differently in the database
      if (finalDisableAutoUpdate === 'metadata')
        finalDisableAutoUpdate = 'version_number'

      // This cast is safe, look above
      channelPayload.disable_auto_update = finalDisableAutoUpdate as any
      log.info(`Set ${appId} channel: ${channel} to ${finalDisableAutoUpdate} disable update strategy to this channel`)
    }
    try {
      const { error: dbError } = await updateOrCreateChannel(supabase, channelPayload)
      if (dbError) {
        log.error(`Cannot set channel the upload key is not allowed to do that, use the "all" for this.`)
        program.error('')
      }
    }
    catch {
      log.error(`Cannot set channel the upload key is not allowed to do that, use the "all" for this.`)
      program.error('')
    }
    await sendEvent(options.apikey, {
      channel: 'channel',
      event: 'Set channel',
      icon: '✅',
      user_id: orgId,
      tags: {
        'app-id': appId,
      },
      notify: false,
    }).catch()
  }
  catch (err) {
    log.error(`Unknow error ${formatError(err)}`)
    program.error('')
  }
  outro(`Done ✅`)
  exit()
}
