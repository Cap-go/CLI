import process from 'node:process'
import { program } from 'commander'
import * as p from '@clack/prompts'
import type { Database } from '../types/supabase.types'
import { checkAppExistsAndHasPermissionErr } from '../api/app'
import type {
  OptionsBase,
} from '../utils'
import {
  checkPlanValid,
  createSupabaseClient,
  findSavedKey,
  formatError,
  getConfig,
  updateOrCreateChannel,
  useLogSnag,
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
  channel?: string
}

const disableAutoUpdatesPossibleOptions = ['major', 'minor', 'metadata', 'none']

export async function setChannel(channel: string, appId: string, options: Options) {
  p.intro(`Set channel`)
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig()
  appId = appId || config?.app?.appId
  const snag = useLogSnag()

  if (!options.apikey) {
    p.log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }
  const supabase = await createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionErr(supabase, options.apikey, appId)

  const { bundle, latest, downgrade, upgrade, ios, android, selfAssign, state, disableAutoUpdate } = options
  if (!channel) {
    p.log.error('Missing argument, you need to provide a channel')
    program.error('')
  }
  if (latest && bundle) {
    p.log.error('Cannot set latest and bundle at the same time')
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
    && disableAutoUpdate == null) {
    p.log.error('Missing argument, you need to provide a option to set')
    program.error('')
  }
  try {
    await checkPlanValid(supabase, userId, options.apikey, appId)
    const channelPayload: Database['public']['Tables']['channels']['Insert'] = {
      created_by: userId,
      app_id: appId,
      name: channel,
      version: undefined as any,
    }
    const bundleVersion = latest ? config?.app?.package?.version : bundle
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
        p.log.error(`Cannot find version ${bundleVersion}`)
        program.error('')
      }
      p.log.info(`Set ${appId} channel: ${channel} to @${bundleVersion}`)
      channelPayload.version = data.id
    }
    if (state != null) {
      if (state === 'public' || state === 'private')
        p.log.info(`Set ${appId} channel: ${channel} to public or private is deprecated, use default or normal instead`)

      p.log.info(`Set ${appId} channel: ${channel} to ${state === 'public' || state === 'default' ? 'default' : 'normal'}`)
      channelPayload.public = state === 'public' || state === 'default'
    }
    if (downgrade != null) {
      p.log.info(`Set ${appId} channel: ${channel} to ${downgrade ? 'allow' : 'disallow'} downgrade`)
      channelPayload.disableAutoUpdateUnderNative = !downgrade
    }
    if (ios != null) {
      p.log.info(`Set ${appId} channel: ${channel} to ${ios ? 'allow' : 'disallow'} ios update`)
      channelPayload.ios = !!ios
    }
    if (android != null) {
      p.log.info(`Set ${appId} channel: ${channel} to ${android ? 'allow' : 'disallow'} android update`)
      channelPayload.android = !!android
    }
    if (selfAssign != null) {
      p.log.info(`Set ${appId} channel: ${channel} to ${selfAssign ? 'allow' : 'disallow'} self assign to this channel`)
      channelPayload.allow_device_self_set = !!selfAssign
    }
    if (disableAutoUpdate != null) {
      let finalDisableAutoUpdate = disableAutoUpdate.toLocaleLowerCase()

      // The user passed an unimplemented strategy
      if (!disableAutoUpdatesPossibleOptions.includes(finalDisableAutoUpdate)) {
        p.log.error(`Channel strategy ${finalDisableAutoUpdate} is not known. The possible values are: ${disableAutoUpdatesPossibleOptions.join(', ')}.`)
        program.error('')
      }

      // This metadata is called differently in the database
      if (finalDisableAutoUpdate === 'metadata')
        finalDisableAutoUpdate = 'version_number'

      // This cast is safe, look above
      channelPayload.disableAutoUpdate = finalDisableAutoUpdate as any
      p.log.info(`Set ${appId} channel: ${channel} to ${finalDisableAutoUpdate} disable update strategy to this channel`)
    }
    try {
      const { error: dbError } = await updateOrCreateChannel(supabase, channelPayload)
      if (dbError) {
        p.log.error(`Cannot set channel the upload key is not allowed to do that, use the "all" for this.`)
        program.error('')
      }
    }
    catch (e) {
      p.log.error(`Cannot set channel the upload key is not allowed to do that, use the "all" for this.`)
      program.error('')
    }
    await snag.track({
      channel: 'channel',
      event: 'Set channel',
      icon: '✅',
      user_id: userId,
      tags: {
        'user-id': userId,
        'app-id': appId,
      },
      notify: false,
    }).catch()
  }
  catch (err) {
    p.log.error(`Unknow error ${formatError(err)}`)
    program.error('')
  }
  p.outro(`Done ✅`)
  process.exit()
}
