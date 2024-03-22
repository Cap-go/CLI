import process from 'node:process'
import * as p from '@clack/prompts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { program } from 'commander'
import type LogSnag from 'logsnag'
import type { Database } from '../types/supabase.types'
import { checkAppExistsAndHasPermissionErr } from '../api/app'
import { checkLatest } from '../api/update'
import { convertAppName, createSupabaseClient, findSavedKey, formatError, getConfig, getLocalConfig, useLogSnag, verifyUser, wait } from '../utils'

export interface OptionsBaseDebug {
  apikey: string
  device?: string
}

export async function markSnag(channel: string, userId: string, snag: LogSnag, event: string, icon = '✅') {
  await snag.track({
    channel,
    event,
    icon,
    user_id: userId,
    notify: false,
  }).catch()
}

export async function cancelCommand(channel: string, command: boolean | symbol, userId: string, snag: LogSnag) {
  if (p.isCancel(command)) {
    await markSnag(channel, userId, snag, 'canceled', '🤷')
    process.exit()
  }
}

interface Order {
  key: string
  sortable?: 'asc' | 'desc'
}

interface QueryStats {
  appId: string
  devicesId?: string[]
  search?: string
  order?: Order[]
  rangeStart?: number
  rangeEnd?: number
  after?: string
}

export async function getStats(supabase: SupabaseClient<Database>, query: QueryStats): Promise<Database['public']['Tables']['stats']['Row'] | null> {
  try {
    const pathStats = 'private/stats'
    const res = await supabase.functions.invoke(pathStats, { body: JSON.stringify(query) })
    const listData = res.data.data as Database['public']['Tables']['stats']['Row'][]
    if (listData?.length > 0)
      return listData[0]
  }
  catch (error) {
    p.log.error(`Cannot get stats ${formatError(error)}`)
  }
  return null
}

export async function waitLog(channel: string, supabase: SupabaseClient<Database>, appId: string, snag: LogSnag, userId: string, deviceId?: string) {
  let loop = true
  let now = new Date().toISOString()
  const appIdUrl = convertAppName(appId)
  const config = await getLocalConfig()
  const baseUrl = `${config.hostWeb}/app/p/${appIdUrl}`
  await markSnag(channel, userId, snag, 'Use waitlog')
  const query: QueryStats = {
    appId,
    devicesId: deviceId ? [deviceId] : undefined,
    order: [{
      key: 'created_at',
      sortable: 'desc',
    }],
    rangeStart: 0,
    rangeEnd: 1,
    after: now,
  }
  while (loop) {
    const data = await getStats(supabase, query)
    //   console.log('data', data)
    if (data) {
      p.log.info(`Log from Device: ${data.device_id}`)
      if (data.action === 'get') {
        p.log.info('Update Sent your your device, wait until event download complete')
        await markSnag(channel, userId, snag, 'done')
      }
      else if (data.action.startsWith('download_')) {
        const action = data.action.split('_')[1]
        if (action === 'complete') {
          p.log.info('Your bundle has been downloaded on your device, background the app now and open it again to see the update')
          await markSnag(channel, userId, snag, 'downloaded')
        }
        else if (action === 'fail') {
          p.log.error('Your bundle has failed to download on your device.')
          p.log.error('Please check if you have network connection and try again')
        }
        else {
          p.log.info(`Your bundle is downloading ${action}% ...`)
        }
      }
      else if (data.action === 'set') {
        p.log.info('Your bundle has been set on your device ❤️')
        loop = false
        await markSnag(channel, userId, snag, 'set')
        return Promise.resolve(data)
      }
      else if (data.action === 'NoChannelOrOverride') {
        p.log.error(`No default channel or override (channel/device) found, please create it here ${baseUrl}`)
      }
      else if (data.action === 'needPlanUpgrade') {
        p.log.error('Your are out of quota, please upgrade your plan here https://web.capgo.app/dashboard/settings/plans')
      }
      else if (data.action === 'missingBundle') {
        p.log.error('Your bundle is missing, please check how you build your app ')
      }
      else if (data.action === 'noNew') {
        p.log.error(`Your version in ${data.platform} is the same as your version uploaded, change it to see the update`)
      }
      else if (data.action === 'disablePlatformIos') {
        p.log.error(`iOS is disabled  in the default channel and your device is an iOS device ${baseUrl}`)
      }
      else if (data.action === 'disablePlatformAndroid') {
        p.log.error(`Android is disabled  in the default channel and your device is an Android device ${baseUrl}`)
      }
      else if (data.action === 'disableAutoUpdateToMajor') {
        p.log.error('Auto update to major version is disabled in the default channel.')
        p.log.error('Set your app to the same major version as the default channel')
      }
      else if (data.action === 'disableAutoUpdateUnderNative') {
        p.log.error('Auto update under native version is disabled in the default channel.')
        p.log.error('Set your app to the same native version as the default channel.')
      }
      else if (data.action === 'disableDevBuild') {
        p.log.error(`Dev build is disabled in the default channel. ${baseUrl}`)
        p.log.error('Set your channel to allow it if you wanna test your app')
      }
      else if (data.action === 'disableEmulator') {
        p.log.error(`Emulator is disabled in the default channel. ${baseUrl}`)
        p.log.error('Set your channel to allow it if you wanna test your app')
      }
      else if (data.action === 'cannotGetBundle') {
        p.log.error(`We cannot get your bundle from the default channel. ${baseUrl}`)
        p.log.error('Are you sure your default channel has a bundle set?')
      }
      else if (data.action === 'set_fail') {
        p.log.error(`Your bundle seems to be corrupted, try to download from ${baseUrl} to identify the issue`)
      }
      else if (data.action === 'reset') {
        p.log.error('Your device has been reset to the builtin bundle, did you added  notifyAppReady in your code?')
      }
      else if (data.action === 'update_fail') {
        p.log.error('Your bundle has been installed but failed to call notifyAppReady')
        p.log.error('Please check if you have network connection and try again')
      }
      else if (data.action === 'checksum_fail') {
        p.log.error('Your bundle has failed to validate checksum, please check your code and send it again to Capgo')
      }
      else {
        p.log.error(`Log from Capgo ${data.action}`)
      }
      now = new Date().toISOString()
      query.after = now
    }
    await wait(1000)
  }
  return Promise.resolve()
}

export async function debugApp(appId: string, options: OptionsBaseDebug) {
  p.intro(`Debug Live update in Capgo`)

  await checkLatest()
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig()

  appId = appId || config?.app?.appId
  const deviceId = options.device
  if (!options.apikey) {
    p.log.error(`Missing API key, you need to provide an API key to delete your app`)
    program.error('')
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }

  const supabase = await createSupabaseClient(options.apikey)
  const snag = useLogSnag()

  const userId = await verifyUser(supabase, options.apikey)

  p.log.info(`Getting active bundle in Capgo`)

  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionErr(supabase, options.apikey, appId)

  const doRun = await p.confirm({ message: `Automatic check if update working in device ?` })
  await cancelCommand('debug', doRun, userId, snag)
  if (doRun) {
    p.log.info(`Wait logs sent to Capgo from ${appId} device, Put the app in background and open it again.`)
    p.log.info('Waiting...')
    await waitLog('debug', supabase, appId, snag, userId, deviceId)
    p.outro(`Done ✅`)
  }
  else {
    // const appIdUrl = convertAppName(appId)
    // p.log.info(`Check logs in https://web.capgo.app/app/p/${appIdUrl}/logs to see if update works.`)
    p.outro(`Canceled ❌`)
  }
  p.outro(`Done ✅`)
  process.exit()
}
