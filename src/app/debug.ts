import process from 'node:process'
import ky from 'ky'
import * as p from '@clack/prompts'
import { program } from 'commander'
import type LogSnag from 'logsnag'
import type { Database } from '../types/supabase.types'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { checkLatest } from '../api/update'
import { OrganizationPerm, convertAppName, createSupabaseClient, findSavedKey, formatError, getConfig, getLocalConfig, getOrganizationId, useLogSnag, verifyUser } from '../utils'

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export interface OptionsBaseDebug {
  apikey: string
  device?: string
}

export async function markSnag(channel: string, orgId: string, snag: LogSnag, event: string, icon = '✅') {
  await snag.track({
    channel,
    event,
    icon,
    user_id: orgId,
    notify: false,
  }).catch()
}

export async function cancelCommand(channel: string, command: boolean | symbol, orgId: string, snag: LogSnag) {
  if (p.isCancel(command)) {
    await markSnag(channel, orgId, snag, 'canceled', '🤷')
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
export async function getStats(apikey: string, query: QueryStats, after: string | null): Promise<LogData | null> {
  try {
    const defaultApiHostPreprod = 'https://api-preprod.capgo.app'
    const dataD = await ky
      .post(`${defaultApiHostPreprod}/private/stats`, {
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
      return dataD[0]
  }
  catch (error) {
    p.log.error(`Cannot get stats ${formatError(error)}`)
  }
  return null
}

export async function waitLog(channel: string, apikey: string, appId: string, snag: LogSnag, orgId: string, deviceId?: string) {
  let loop = true
  const appIdUrl = convertAppName(appId)
  const config = await getLocalConfig()
  const baseUrl = `${config.hostWeb}/app/p/${appIdUrl}`
  await markSnag(channel, orgId, snag, 'Use waitlog')
  const query: QueryStats = {
    appId,
    devicesId: deviceId ? [deviceId] : undefined,
    order: [{
      key: 'created_at',
      sortable: 'desc',
    }],
    limit: 1,
    rangeStart: new Date().toISOString(),
  }
  let after: string | null = null
  while (loop) {
    const data = await getStats(apikey, query, after)
    if (data) {
      after = data.created_at
      p.log.info(`Log from Device: ${data.device_id}`)
      if (data.action === 'get') {
        p.log.info('Update Sent your your device, wait until event download complete')
        await markSnag(channel, orgId, snag, 'done')
      }
      else if (data.action.startsWith('download_')) {
        const action = data.action.split('_')[1]
        if (action === 'complete') {
          p.log.info('Your bundle has been downloaded on your device, background the app now and open it again to see the update')
          await markSnag(channel, orgId, snag, 'downloaded')
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
        await markSnag(channel, orgId, snag, 'set')
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
        p.log.error(`Your version in ${data.device_id} is the same as your version uploaded, change it to see the update`)
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
    }
    await wait(5000)
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
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.admin)

  const orgId = await getOrganizationId(supabase, appId)

  const doRun = await p.confirm({ message: `Automatic check if update working in device ?` })
  await cancelCommand('debug', doRun, userId, snag)
  if (doRun) {
    p.log.info(`Wait logs sent to Capgo from ${appId} device, Put the app in background and open it again.`)
    p.log.info('Waiting... (there is a usual delay of 15 seconds until the backend process the logs)')
    await waitLog('debug', options.apikey, appId, snag, orgId, deviceId)
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
