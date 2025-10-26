import type { Database } from '../types/supabase.types'
import type { OptionsBase } from '../utils'
import { intro, log, outro } from '@clack/prompts'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import {
  checkCompatibilityNativePackages,
  checkPlanValid,
  createSupabaseClient,
  findSavedKey,
  getAppId,
  getBundleVersion,
  getConfig,
  getOrganizationId,
  getPMAndCommand,
  isCompatible,
  OrganizationPerm,
  sendEvent,
  updateOrCreateChannel,
  verifyUser,
} from '../utils'

export interface OptionsSetChannel extends OptionsBase {
  bundle?: string
  state?: string
  downgrade?: boolean
  latest?: boolean
  latestRemote?: boolean
  ios?: boolean
  android?: boolean
  selfAssign?: boolean
  disableAutoUpdate?: string
  dev?: boolean
  emulator?: boolean
  packageJson?: string
  ignoreMetadataCheck?: boolean
}

const disableAutoUpdatesPossibleOptions = ['major', 'minor', 'metadata', 'patch', 'none']

export async function setChannel(channel: string, appId: string, options: OptionsSetChannel, silent = false) {
  if (!silent)
    intro('Set channel')

  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
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

  if (!channel) {
    if (!silent)
      log.error('Missing argument, you need to provide a channel')
    throw new Error('Missing channel id')
  }

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])

  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.admin, silent)
  const orgId = await getOrganizationId(supabase, appId)

  const {
    bundle,
    state,
    downgrade,
    latest,
    latestRemote,
    ios,
    android,
    selfAssign,
    disableAutoUpdate,
    dev,
    emulator,
  } = options

  if (latest && bundle) {
    if (!silent)
      log.error('Cannot set latest and bundle at the same time')
    throw new Error('Cannot set both latest and bundle simultaneously')
  }

  if (latestRemote && bundle) {
    if (!silent)
      log.error('Cannot set latest remote and bundle at the same time')
    throw new Error('Cannot set both latest remote and bundle simultaneously')
  }

  if (latestRemote && latest) {
    if (!silent)
      log.error('Cannot set latest remote and latest at the same time')
    throw new Error('Cannot set both latest remote and latest simultaneously')
  }

  if (
    bundle == null
    && state == null
    && latest == null
    && latestRemote == null
    && downgrade == null
    && ios == null
    && android == null
    && selfAssign == null
    && dev == null
    && emulator == null
    && disableAutoUpdate == null
  ) {
    if (!silent)
      log.error('Missing argument, you need to provide a option to set')
    throw new Error('No channel option provided')
  }

  await checkPlanValid(supabase, orgId, options.apikey, appId)

  const channelPayload: Database['public']['Tables']['channels']['Insert'] = {
    created_by: userId,
    app_id: appId,
    name: channel,
    owner_org: orgId,
    version: undefined as any,
  }

  const { error: channelError } = await supabase
    .from('channels')
    .select()
    .eq('app_id', appId)
    .eq('name', channel)
    .single()

  if (channelError) {
    if (!silent)
      log.error(`Cannot find channel ${channel}`)
    throw new Error(`Cannot find channel ${channel}`)
  }

  const resolvedBundleVersion = latest
    ? (extConfig?.config?.plugins?.CapacitorUpdater?.version || getBundleVersion('', options.packageJson))
    : bundle

  if (resolvedBundleVersion != null) {
    const { data, error: vError } = await supabase
      .from('app_versions')
      .select()
      .eq('app_id', appId)
      .eq('name', resolvedBundleVersion)
      .eq('user_id', userId)
      .eq('deleted', false)
      .single()

    if (vError || !data) {
      if (!silent)
        log.error(`Cannot find version ${resolvedBundleVersion}`)
      throw new Error(`Cannot find version ${resolvedBundleVersion}`)
    }

    if (!options.ignoreMetadataCheck) {
      const { finalCompatibility, localDependencies } = await checkCompatibilityNativePackages(
        supabase,
        appId,
        channel,
        (data.native_packages as any) ?? [],
      )

      const pm = getPMAndCommand()

      if (localDependencies.length > 0 && finalCompatibility.some(item => !isCompatible(item))) {
        if (!silent) {
          log.warn(`Bundle NOT compatible with ${channel} channel`)
          log.warn(`You can check compatibility with "${pm.runner} @capgo/cli bundle compatibility"`)
        }
        throw new Error(`Bundle is not compatible with ${channel} channel`)
      }

      if (!silent) {
        if (localDependencies.length === 0 && finalCompatibility.length > 0)
          log.info(`Ignoring check compatibility with ${channel} channel because the bundle does not contain any native packages`)
        else
          log.info(`Bundle is compatible with ${channel} channel`)
      }
    }

    if (!silent)
      log.info(`Set ${appId} channel: ${channel} to @${resolvedBundleVersion}`)

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
      if (!silent)
        log.error('Cannot find latest remote version')
      throw new Error('Cannot find latest remote version')
    }

    if (!options.ignoreMetadataCheck) {
      const { finalCompatibility } = await checkCompatibilityNativePackages(
        supabase,
        appId,
        channel,
        (data.native_packages as any) ?? [],
      )

      const pm = getPMAndCommand()

      if (finalCompatibility.some(item => !isCompatible(item))) {
        if (!silent) {
          log.warn(`Bundle NOT compatible with ${channel} channel`)
          log.warn(`You can check compatibility with "${pm.runner} @capgo/cli bundle compatibility"`)
        }
        throw new Error(`Latest remote bundle is not compatible with ${channel} channel`)
      }
    }

    if (!silent)
      log.info(`Set ${appId} channel: ${channel} to @${data.name}`)

    channelPayload.version = data.id
  }

  if (state != null) {
    if (state !== 'normal' && state !== 'default') {
      if (!silent)
        log.error(`State ${state} is not known. The possible values are: normal, default.`)
      throw new Error(`Unknown state ${state}. Expected normal or default`)
    }

    if (!silent)
      log.info(`Set ${appId} channel: ${channel} to ${state}`)

    channelPayload.public = state === 'default'
  }

  if (downgrade != null) {
    if (!silent)
      log.info(`Set ${appId} channel: ${channel} to ${downgrade ? 'allow' : 'disallow'} downgrade`)
    channelPayload.disable_auto_update_under_native = !downgrade
  }

  if (ios != null) {
    if (!silent)
      log.info(`Set ${appId} channel: ${channel} to ${ios ? 'allow' : 'disallow'} ios update`)
    channelPayload.ios = !!ios
  }

  if (android != null) {
    if (!silent)
      log.info(`Set ${appId} channel: ${channel} to ${android ? 'allow' : 'disallow'} android update`)
    channelPayload.android = !!android
  }

  if (selfAssign != null) {
    if (!silent)
      log.info(`Set ${appId} channel: ${channel} to ${selfAssign ? 'allow' : 'disallow'} self assign to this channel`)
    channelPayload.allow_device_self_set = !!selfAssign
  }

  if (dev != null) {
    if (!silent)
      log.info(`Set ${appId} channel: ${channel} to ${dev ? 'allow' : 'disallow'} dev devices`)
    channelPayload.allow_dev = !!dev
  }

  if (emulator != null) {
    if (!silent)
      log.info(`Set ${appId} channel: ${channel} to ${emulator ? 'allow' : 'disallow'} emulator devices`)
    channelPayload.allow_emulator = !!emulator
  }

  if (disableAutoUpdate != null) {
    let finalDisableAutoUpdate = disableAutoUpdate.toLowerCase()

    if (!disableAutoUpdatesPossibleOptions.includes(finalDisableAutoUpdate)) {
      if (!silent)
        log.error(`Channel strategy ${finalDisableAutoUpdate} is not known. The possible values are: ${disableAutoUpdatesPossibleOptions.join(', ')}.`)
      throw new Error(`Unknown channel strategy ${finalDisableAutoUpdate}`)
    }

    if (finalDisableAutoUpdate === 'metadata')
      finalDisableAutoUpdate = 'version_number'

    channelPayload.disable_auto_update = finalDisableAutoUpdate as any

    if (!silent)
      log.info(`Set ${appId} channel: ${channel} to ${finalDisableAutoUpdate} disable update strategy to this channel`)
  }

  const { error: dbError } = await updateOrCreateChannel(supabase, channelPayload)
  if (dbError) {
    if (!silent)
      log.error('Cannot set channel the upload key is not allowed to do that, use the "all" for this.')
    throw new Error('Upload key is not allowed to set this channel')
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
  }).catch(() => {})

  if (!silent)
    outro('Done ✅')

  return true
}
