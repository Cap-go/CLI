import { exit } from 'node:process'
import { intro, isCancel, log, select, spinner } from '@clack/prompts'
import { explainCommonUpdateError, prepareUpdateProbe, singleProbeRequest } from './app/updateProbe'
import { getAppId, getConfig } from './utils'

interface ProbeOptions {
  platform?: string
}

export async function probe(options: ProbeOptions) {
  intro('Probe Capgo updates endpoint')

  const extConfig = await getConfig()
  const capConfig = extConfig.config

  const appId = getAppId(undefined, capConfig)
  if (!appId) {
    log.error('Could not resolve app ID from capacitor config. Ensure appId is set in capacitor.config.ts or CapacitorUpdater.appId is configured.')
    exit(1)
  }

  let platform: 'ios' | 'android'
  if (options.platform === 'ios' || options.platform === 'android') {
    platform = options.platform
  }
  else if (options.platform) {
    log.error(`Invalid platform "${options.platform}". Must be "ios" or "android".`)
    exit(1)
  }
  else {
    const selected = await select({
      message: 'Which platform do you want to probe?',
      options: [
        { value: 'ios', label: 'iOS' },
        { value: 'android', label: 'Android' },
      ],
    })
    if (isCancel(selected)) {
      log.warn('Probe cancelled.')
      exit(0)
    }
    platform = selected as 'ios' | 'android'
  }

  const prepared = await prepareUpdateProbe(platform, capConfig, appId)
  if (!prepared.ok) {
    log.error(`Probe setup failed: ${prepared.error}`)
    exit(1)
  }

  const ctx = prepared.context
  log.info(`Endpoint: ${ctx.endpoint}`)
  log.info(`Platform: ${ctx.payload.platform}, version_name: ${ctx.payload.version_name}, version_build: ${ctx.payload.version_build}`)
  log.info(`version_build source: ${ctx.versionBuildSource}`)
  log.info(`app_id: ${ctx.payload.app_id} (${ctx.appIdSource})`)
  log.info(`Native values source: ${ctx.nativeSource}`)

  const s = spinner()
  s.start('Probing updates endpoint...')

  let result
  try {
    result = await singleProbeRequest(ctx.endpoint, ctx.payload)
  }
  catch (error) {
    s.stop('Probe request failed')
    log.error(`Network error: ${error instanceof Error ? error.message : String(error)}`)
    exit(1)
  }

  if (result.success) {
    s.stop(`Update available: ${result.availableVersion}`)
  }
  else {
    s.stop('No update available')
    log.warn(`Reason: ${result.reason}`)
    if (result.backendRefusal)
      log.warn('The backend actively refused the request (not a cache/propagation issue).')
    if (result.errorCode)
      log.warn(`Error code: ${result.errorCode}`)
    if (result.backendMessage)
      log.warn(`Backend message: ${result.backendMessage}`)
    const hints = explainCommonUpdateError(result)
    for (const hint of hints)
      log.warn(`  ${hint}`)
  }
}
