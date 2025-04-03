import type { Database } from '../types/supabase.types'
import type {
  OptionsBase,
} from '../utils'
import { exit } from 'node:process'
import { intro, isCancel, log, outro, select } from '@clack/prompts'
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
  upgrade?: boolean
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

  const { bundle, state, downgrade, latest, upgrade, ios, android, selfAssign, disableAutoUpdate, dev, emulator } = options
  if (!channel) {
    log.error('Missing argument, you need to provide a channel')
    program.error('')
  }
  if (latest && bundle) {
    log.error('Cannot set latest and bundle at the same time')
    program.error('')
  }
  if (bundle == null
    && state == null
    && latest == null
    && downgrade == null
    && upgrade == null
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
    let publicChannel = null as boolean | null
    if (state != null) {
      if (state === 'public' || state === 'private')
        log.info(`Set ${appId} channel: ${channel} to public or private is deprecated, use default or normal instead`)

      log.info(`Set ${appId} channel: ${channel} to ${state === 'public' || state === 'default' ? 'default' : 'normal'}`)
      publicChannel = state === 'public' || state === 'default'
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
      const { error: dbError, data: channelData } = await updateOrCreateChannel(supabase, channelPayload)
      if (dbError) {
        log.error(`Cannot set channel the upload key is not allowed to do that, use the "all" for this.`)
        program.error('')
      }
      if (publicChannel != null) {
        const { data: appData, error: appError } = await supabase
          .from('apps')
          .select('default_channel_android, default_channel_ios')
          .eq('app_id', appId)
          .single()
        if (appError) {
          log.error(`Cannot get app ${appId}`)
          program.error('')
        }
        if (!publicChannel) {
          if (appData?.default_channel_android !== channelData.id && appData?.default_channel_ios !== channelData.id) {
            log.info(`Channel ${channel} is not public for both iOS and Android.`)
          }
          else {
            if (appData?.default_channel_android === channelData.id) {
              const { error: androidError } = await supabase
                .from('apps')
                .update({ default_channel_android: null })
                .eq('app_id', appId)
              if (androidError) {
                log.error(`Cannot set default channel android to null`)
                program.error('')
              }
            }
            if (appData?.default_channel_ios === channelData.id) {
              const { error: iosError } = await supabase
                .from('apps')
                .update({ default_channel_ios: null })
                .eq('app_id', appId)
              if (iosError) {
                log.error(`Cannot set default channel ios to null`)
                program.error('')
              }
            }
            if ((appData?.default_channel_ios === null && appData?.default_channel_android === channelData.id) || (appData?.default_channel_ios === channelData.id && appData?.default_channel_android === null)) {
              const { error: bothError } = await supabase
                .from('apps')
                .update({ default_channel_sync: true })
                .eq('app_id', appId)
              if (bothError) {
                log.error(`Cannot set default channel sync to true`)
                program.error('')
              }
            }
          }
        }
        else if (appData?.default_channel_ios === channelData.id && appData?.default_channel_android === channelData.id) {
          // check if pehaps the channel is already public
          log.info(`Channel ${channel} is already public for both iOS and Android.`)
        }
        else {
          // here we need to ask the user if he wants the channel to become public for iOS android or Both
          const platformType = await select({
            message: 'Do you want the channel to become public for iOS android or Both?',
            options: [
              { value: 'iOS', label: 'iOS' },
              { value: 'Android', label: 'Android' },
              { value: 'Both', label: 'Both' },
            ],
          })
          if (isCancel(platformType)) {
            outro(`Bye 👋`)
            exit()
          }

          const platform = platformType as 'iOS' | 'Android' | 'Both'
          if (platform === 'iOS' || platform === 'Android') {
            const opositePlatform = platform === 'iOS' ? 'android' : 'ios'
            const { error: singlePlatformError } = await supabase
              .from('apps')
              .update({ [`default_channel_${platform.toLowerCase()}`]: channelData.id, default_channel_sync: appData?.[`default_channel_${opositePlatform}`] === channelData.id })
              .eq('app_id', appId)
            if (singlePlatformError) {
              log.error(`Failed to set default channel ${platform} to ${channel}.`)
              log.error(`This may be due to insufficient permissions or a database error.${formatError(singlePlatformError)}`)
              program.error('')
            }
          }
          else {
            const { error: bothPlatformError } = await supabase
              .from('apps')
              .update({ default_channel_sync: true, default_channel_ios: channelData.id, default_channel_android: channelData.id })
              .eq('app_id', appId)
            if (bothPlatformError) {
              log.error(`Failed to synchronize default channel settings across both platforms.`)
              log.error(`Unable to set channel '${channel}' as default for both iOS and Android.${formatError(bothPlatformError)}`)
              program.error('')
            }
          }
        }
        if (publicChannel && (appData?.default_channel_ios !== channelData.id || appData?.default_channel_android !== channelData.id)) {
          log.info(`Set ${appId} channel: ${channel} to ${publicChannel ? 'public' : 'private'}`)
        }
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
    log.error(`An unexpected error occurred while setting channel '${channel}' for app '${appId}'.`)
    log.error(`Please verify your inputs and try again.${formatError(err)}`)
    program.error('')
  }
  outro(`Done ✅`)
  exit()
}
