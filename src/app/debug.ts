import type { Database } from '../types/supabase.types'
import { exit } from 'node:process'
import { confirm as confirmC, intro, isCancel, log, outro, spinner } from '@clack/prompts'
import { program } from 'commander'
import ky from 'ky'
import { checkLatest } from '../api/update'
import { convertAppName, createSupabaseClient, findSavedKey, formatError, getConfig, getLocalConfig, getOrganizationId, sendEvent } from '../utils'

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export interface OptionsBaseDebug {
  apikey: string
  device?: string
}

export async function markSnag(channel: string, orgId: string, apikey: string, event: string, icon = '✅') {
  await sendEvent(apikey, {
    channel,
    event,
    icon,
    user_id: orgId,
    notify: false,
  })
}

export async function cancelCommand(channel: string, command: boolean | symbol, orgId: string, apikey: string) {
  if (isCancel(command)) {
    await markSnag(channel, orgId, apikey, 'canceled', '🤷')
    exit()
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
  rangeStart?: string
  rangeEnd?: string
  limit?: number
}
interface LogData {
  app_id: string
  device_id: string
  action: Database['public']['Enums']['stats_action']
  version_id: number
  version?: number
  created_at: string
}
export async function getStats(apikey: string, query: QueryStats, after: string | null): Promise<LogData[]> {
  try {
    const localConfig = await getLocalConfig()
    const dataD = await ky
      .post(`${localConfig.hostApi}/private/stats`, {
        headers: {
          'Content-Type': 'application/json',
          'capgkey': apikey,
        },
        body: JSON.stringify(query),
      })
      .then(res => res.json<LogData[]>())
      .catch((err) => {
        console.error('Cannot get devices', err)
        return [] as LogData[]
      })
    if (dataD?.length > 0 && (after === null || after !== dataD[0].created_at))
      return dataD
  }
  catch (error) {
    log.error(`Cannot get stats ${formatError(error)}`)
  }
  return []
}

async function displayError(data: LogData, channel: string, orgId: string, apikey: string, baseAppUrl: string, baseUrl: string) {
  log.info(`Log from Device: ${data.device_id}`)
  if (data.action === 'get') {
    log.info('Update Sent your your device, wait until event download complete')
    await markSnag(channel, orgId, apikey, 'done')
  }
  else if (data.action.startsWith('download_')) {
    const action = data.action.split('_')[1]
    if (action === 'complete') {
      log.info('Your bundle has been downloaded on your device, background the app now and open it again to see the update')
      await markSnag(channel, orgId, apikey, 'downloaded')
    }
    else if (action === 'fail') {
      log.error('Your bundle has failed to download on your device.')
      log.error('Please check if you have network connection and try again')
    }
    else {
      log.info(`Your bundle is downloading ${action}% ...`)
    }
  }
  else if (data.action === 'set') {
    log.info('Your bundle has been set on your device ❤️')
    await markSnag(channel, orgId, apikey, 'set')
    return false
  }
  else if (data.action === 'NoChannelOrOverride') {
    log.error(`No default channel or override (channel/device) found, please create it here ${baseAppUrl}`)
  }
  else if (data.action === 'needPlanUpgrade') {
    log.error(`Your are out of quota, please upgrade your plan here ${baseUrl}/dashboard/settings/plans`)
  }
  else if (data.action === 'missingBundle') {
    log.error('Your bundle is missing, please check how you build your app')
  }
  else if (data.action === 'noNew') {
    log.error(`The version number you uploaded to your default channel in Capgo, is the same as the present in the device ${data.device_id}.`)
    log.error(`To fix it, ensure the variable:
      - iOS: keyCFBundleShortVersionString or MARKETING_VERSION
      - Android: versionName
    Are lower than the version number you uploaded to Capgo.`)
    log.error('More info here: https://capgo.app/blog/how-version-work-in-capgo/#versioning-system')
  }
  else if (data.action === 'disablePlatformIos') {
    log.error(`iOS is disabled in the default channel and your device ${data.device_id} is an iOS device ${baseAppUrl}`)
  }
  else if (data.action === 'disablePlatformAndroid') {
    log.error(`Android is disabled in the default channel and your device ${data.device_id} is an Android device ${baseAppUrl}`)
  }
  else if (data.action === 'disableAutoUpdateToMajor') {
    log.error(`The version number you uploaded to your default channel in Capgo, is a major version higher (ex: 1.0.0 in device to 2.0.0 in Capgo) than the present in the device ${data.device_id}.`)
    log.error('Capgo is set by default to protect you from this, and avoid sending breaking changes incompatible with the native code present in the device.')
    log.error(`To fix it, ensure the variable:
  - iOS: keyCFBundleShortVersionString or MARKETING_VERSION
  - Android: versionName
Are lower than the version number you uploaded to Capgo.`)
    log.error('More info here: https://capgo.app/blog/how-version-work-in-capgo/#versioning-system')
  }
  else if (data.action === 'disableAutoUpdateUnderNative') {
    log.error(`The version number you uploaded to your default channel in Capgo, is lower than the present in the device ${data.device_id}.`)
    log.error(`To fix it, ensure the variable:
      - iOS: keyCFBundleShortVersionString or MARKETING_VERSION
      - Android: versionName
    Are lower than the version number you uploaded to Capgo.`)
    log.error('More info here: https://capgo.app/blog/how-version-work-in-capgo/#versioning-system')
  }
  else if (data.action === 'disableDevBuild') {
    log.error(`Dev build is disabled in the default channel. ${baseAppUrl}`)
    log.error('Set your channel to allow it if you wanna test your app')
  }
  else if (data.action === 'disableEmulator') {
    log.error(`Emulator is disabled in the default channel. ${baseAppUrl}`)
    log.error('Set your channel to allow it if you wanna test your app')
  }
  else if (data.action === 'cannotGetBundle') {
    log.error(`We cannot get your bundle from the default channel. ${baseAppUrl}`)
    log.error('Are you sure your default channel has a bundle set?')
  }
  else if (data.action === 'set_fail') {
    log.error(`Your bundle seems to be corrupted, try to download from ${baseAppUrl} to identify the issue`)
  }
  else if (data.action === 'reset') {
    log.error('Your device has been reset to the builtin bundle, did notifyAppReady() is present in the code builded and uploaded to Capgo ?')
  }
  else if (data.action === 'update_fail') {
    log.error('Your bundle has been installed but failed to call notifyAppReady()')
    log.error('Please check if you have network connection and try again')
  }
  else if (data.action === 'checksum_fail') {
    log.error('Your bundle has failed to validate checksum, please check your code and send it again to Capgo')
  }
  else {
    log.error(`Log from Capgo ${data.action}`)
  }
  return true
}

export async function waitLog(channel: string, apikey: string, appId: string, orgId: string, deviceId?: string) {
  let loop = true
  const appIdUrl = convertAppName(appId)
  const config = await getLocalConfig()
  const baseAppUrl = `${config.hostWeb}/app/p/${appIdUrl}`
  await markSnag(channel, orgId, apikey, 'Use waitlog')
  const query: QueryStats = {
    appId,
    devicesId: deviceId ? [deviceId] : undefined,
    order: [{
      key: 'created_at',
      sortable: 'desc',
    }],
    rangeStart: new Date().toISOString(),
  }
  let after: string | null = null
  const s = spinner()
  s.start(`Waiting for logs (Expect delay of 30 sec)`)
  while (loop) {
    await wait(5000)
    const data = await getStats(apikey, query, after)
    if (data.length > 0) {
      after = data[0].created_at
      for (const d of data) {
        loop = await displayError(d, channel, orgId, apikey, baseAppUrl, config.hostWeb)
        if (!loop)
          break
      }
    }
  }
  s.stop(`Stop watching logs`)
  return Promise.resolve()
}

export async function debugApp(appId: string, options: OptionsBaseDebug) {
  intro(`Debug Live update in Capgo`)

  await checkLatest()
  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
  appId = appId || extConfig?.config?.appId
  const deviceId = options.device
  if (!options.apikey) {
    log.error(`Missing API key, you need to provide an API key to delete your app`)
    program.error('')
  }
  if (!appId) {
    log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }

  const supabase = await createSupabaseClient(options.apikey)
  const orgId = await getOrganizationId(supabase, appId)

  const doRun = await confirmC({ message: `Automatic check if update working in device ?` })
  await cancelCommand('debug', doRun, orgId, options.apikey)
  if (doRun) {
    log.info(`Wait logs sent to Capgo from ${appId} device, Please open your app 💪`)
    await waitLog('debug', options.apikey, appId, orgId, deviceId)
    outro(`Done ✅`)
  }
  else {
    outro(`Canceled ❌`)
  }
  outro(`Done ✅`)
  exit()
}
