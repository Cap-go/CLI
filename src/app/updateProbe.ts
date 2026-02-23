import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { getPlatformDirFromCapacitorConfig } from '../build/platform-paths'
import { getAppId, getInstalledVersion } from '../utils'

const defaultUpdateUrl = 'https://plugin.capgo.app/updates'
export const updateProbeDeviceId = '00000000-0000-0000-0000-000000000000'
const updateProbeTimeoutMs = 60_000
const updateProbeIntervalMs = 5_000

interface NativeVersionInfo {
  versionName: string
  versionCode?: string
  source: string
}

interface UpdateProbePayload {
  app_id: string
  device_id: string
  version_name: string
  version_build: string
  is_emulator: boolean
  is_prod: boolean
  platform: 'ios' | 'android'
  plugin_version: string
  defaultChannel: string
}

export interface PreparedUpdateProbe {
  endpoint: string
  payload: UpdateProbePayload
  nativeSource: string
  versionBuildSource: string
  appIdSource: string
}

export type PrepareUpdateProbeResult =
  | { ok: true, context: PreparedUpdateProbe }
  | { ok: false, error: string }

interface ParsedUpdateResponse {
  status: 'available' | 'retry' | 'failed'
  detail: string
  responseVersion?: string
  errorCode?: string
  backendMessage?: string
  extra?: Record<string, unknown>
}

export type UpdateProbePollResult =
  | { success: true, attempt: number, availableVersion: string }
  | {
      success: false
      attempt: number
      reason: string
      backendRefusal: boolean
      errorCode?: string
      backendMessage?: string
      extra?: Record<string, unknown>
    }

function readTextIfExists(filePath: string): string | undefined {
  if (!existsSync(filePath))
    return undefined
  return readFileSync(filePath, 'utf-8')
}

function parseAndroidNativeVersion(platformDir: string): NativeVersionInfo | undefined {
  const candidates = [
    join(cwd(), platformDir, 'app', 'build.gradle'),
    join(cwd(), platformDir, 'app', 'build.gradle.kts'),
  ]
  for (const candidate of candidates) {
    const content = readTextIfExists(candidate)
    if (!content)
      continue
    const versionName = content.match(/versionName\s*(?:=\s*)?["']([^"']+)["']/)?.[1]
    const versionCode = content.match(/versionCode\s*(?:=\s*)?(\d+)/)?.[1]
    if (versionName) {
      return {
        versionName,
        versionCode,
        source: candidate,
      }
    }
  }
  return undefined
}

function parsePlistString(content: string, key: string) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = content.match(new RegExp(`<key>${escapedKey}</key>\\s*<string>([^<]+)</string>`))
  return match?.[1]?.trim()
}

function parsePbxprojSetting(content: string, setting: 'MARKETING_VERSION' | 'CURRENT_PROJECT_VERSION') {
  const match = content.match(new RegExp(`${setting}\\s*=\\s*([^;]+);`))
  const raw = match?.[1]?.trim()
  if (!raw)
    return undefined
  return raw.replace(/"/g, '').trim()
}

function parseIosNativeVersion(platformDir: string): NativeVersionInfo | undefined {
  const appRoot = join(cwd(), platformDir, 'App')
  const plistPath = join(appRoot, 'App', 'Info.plist')
  const pbxprojPath = join(appRoot, 'App.xcodeproj', 'project.pbxproj')
  const plist = readTextIfExists(plistPath)
  const pbxproj = readTextIfExists(pbxprojPath)
  if (!plist)
    return undefined

  let versionName = parsePlistString(plist, 'CFBundleShortVersionString')
  let versionCode = parsePlistString(plist, 'CFBundleVersion')

  if (versionName === '$(MARKETING_VERSION)')
    versionName = pbxproj ? parsePbxprojSetting(pbxproj, 'MARKETING_VERSION') : undefined
  if (versionCode === '$(CURRENT_PROJECT_VERSION)')
    versionCode = pbxproj ? parsePbxprojSetting(pbxproj, 'CURRENT_PROJECT_VERSION') : undefined

  if (!versionName && pbxproj)
    versionName = parsePbxprojSetting(pbxproj, 'MARKETING_VERSION')
  if (!versionCode && pbxproj)
    versionCode = parsePbxprojSetting(pbxproj, 'CURRENT_PROJECT_VERSION')

  if (!versionName)
    return undefined

  return {
    versionName,
    versionCode,
    source: plistPath,
  }
}

function getConfiguredUpdaterVersion(capConfig: any): string | undefined {
  const configured = capConfig?.plugins?.CapacitorUpdater?.version
  if (typeof configured === 'string' && configured.trim().length > 0)
    return configured.trim()
  return undefined
}

function getProbeDefaultChannel(capConfig: any): string {
  const configured = capConfig?.plugins?.CapacitorUpdater?.defaultChannel
  if (typeof configured === 'string' && configured.trim().length > 0)
    return configured.trim()
  return ''
}

function getUpdateUrl(capConfig: any): string {
  const configured = capConfig?.plugins?.CapacitorUpdater?.updateUrl
  if (typeof configured === 'string' && configured.trim().length > 0)
    return configured.trim()
  return defaultUpdateUrl
}

function toMajor(version: string): number | undefined {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match)
    return undefined
  const major = Number.parseInt(match[1], 10)
  return Number.isNaN(major) ? undefined : major
}

export function getLikelyMajorBlockWarning(capConfig: any, nextOtaVersion: string): string | undefined {
  const configuredVersion = getConfiguredUpdaterVersion(capConfig)
  if (!configuredVersion)
    return undefined

  const configuredMajor = toMajor(configuredVersion)
  const targetMajor = toMajor(nextOtaVersion)
  if (configuredMajor === undefined || targetMajor === undefined)
    return undefined

  if (targetMajor > configuredMajor) {
    return `CapacitorUpdater.version is ${configuredVersion} while this OTA upload targets ${nextOtaVersion}. If your channel blocks major upgrades, update checks can fail with disable_auto_update_to_major.`
  }
  return undefined
}

export async function prepareUpdateProbe(
  platform: 'ios' | 'android',
  capConfig: any,
  onboardingAppId: string,
  packageJsonPathFromOnboarding?: string,
): Promise<PrepareUpdateProbeResult> {
  const platformDir = getPlatformDirFromCapacitorConfig(capConfig, platform)
  const nativeVersion = platform === 'android'
    ? parseAndroidNativeVersion(platformDir)
    : parseIosNativeVersion(platformDir)
  if (!nativeVersion) {
    return {
      ok: false,
      error: `Unable to resolve native ${platform.toUpperCase()} version values from platform files in "${platformDir}".`,
    }
  }

  const configuredVersion = getConfiguredUpdaterVersion(capConfig)
  const probeVersionBuild = configuredVersion || nativeVersion.versionName
  const versionBuildSource = configuredVersion ? 'CapacitorUpdater.version from capacitor config' : `native ${platform.toUpperCase()} versionName`

  const packageJsonPath = packageJsonPathFromOnboarding || join(cwd(), 'package.json')
  const projectPath = packageJsonPath.replace('/package.json', '')
  const pluginVersion = await getInstalledVersion('@capgo/capacitor-updater', projectPath, packageJsonPath)
  if (!pluginVersion) {
    return {
      ok: false,
      error: 'Unable to resolve installed @capgo/capacitor-updater version from this project.',
    }
  }

  const resolvedAppId = getAppId(undefined, capConfig) || onboardingAppId
  const appIdSource = resolvedAppId === onboardingAppId ? 'onboarding app id' : 'CapacitorUpdater.appId from capacitor config'

  return {
    ok: true,
    context: {
      endpoint: getUpdateUrl(capConfig),
      payload: {
        app_id: resolvedAppId,
        device_id: updateProbeDeviceId,
        version_name: 'builtin',
        version_build: probeVersionBuild,
        is_emulator: false,
        is_prod: false,
        platform,
        plugin_version: pluginVersion,
        defaultChannel: getProbeDefaultChannel(capConfig),
      },
      nativeSource: nativeVersion.source,
      versionBuildSource,
      appIdSource,
    },
  }
}

function parseUpdateResponse(json: any, currentVersionName: string): ParsedUpdateResponse {
  const error = typeof json?.error === 'string' ? json.error : undefined
  const message = typeof json?.message === 'string' ? json.message : undefined
  const responseVersion = typeof json?.version === 'string' ? json.version : undefined

  if (error === 'no_new_version_available' || (responseVersion && responseVersion === currentVersionName)) {
    return {
      status: 'retry',
      detail: message || 'No new version available yet',
    }
  }

  if (error) {
    const extra: Record<string, unknown> = {}
    if (json && typeof json === 'object') {
      for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
        if (key !== 'error' && key !== 'message')
          extra[key] = value
      }
    }
    return {
      status: 'failed',
      detail: `${error}: ${message ?? 'Unknown backend message'}`,
      errorCode: error,
      backendMessage: message,
      extra,
    }
  }

  if (responseVersion && responseVersion !== currentVersionName) {
    return {
      status: 'available',
      detail: `Update ${responseVersion} is available`,
      responseVersion,
    }
  }

  return {
    status: 'failed',
    detail: `Unexpected response format: ${JSON.stringify(json)}`,
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function pollUpdateAvailability(endpoint: string, payload: UpdateProbePayload): Promise<UpdateProbePollResult> {
  const start = Date.now()
  let attempt = 0
  let lastReason = 'Timed out waiting for update availability'

  while (Date.now() - start <= updateProbeTimeoutMs) {
    attempt += 1
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      let json: any
      try {
        json = await response.json()
      }
      catch {
        json = { error: 'invalid_json_response', message: 'Non-JSON response from updates endpoint' }
      }

      if (!response.ok && response.status !== 200) {
        const errorCode = typeof json?.error === 'string' ? json.error : undefined
        const backendMessage = typeof json?.message === 'string' ? json.message : undefined
        const extra: Record<string, unknown> = {}
        if (json && typeof json === 'object') {
          for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
            if (key !== 'error' && key !== 'message')
              extra[key] = value
          }
        }
        return {
          success: false,
          attempt,
          reason: `HTTP ${response.status}: ${JSON.stringify(json)}`,
          backendRefusal: !!errorCode,
          errorCode,
          backendMessage,
          extra,
        }
      }

      const parsed = parseUpdateResponse(json, payload.version_name)
      if (parsed.status === 'available') {
        return {
          success: true,
          attempt,
          availableVersion: parsed.responseVersion ?? '',
        }
      }

      if (parsed.status === 'failed') {
        return {
          success: false,
          attempt,
          reason: parsed.detail,
          backendRefusal: !!parsed.errorCode,
          errorCode: parsed.errorCode,
          backendMessage: parsed.backendMessage,
          extra: parsed.extra,
        }
      }

      lastReason = parsed.detail
    }
    catch (error) {
      return {
        success: false,
        attempt,
        reason: `Network error: ${error instanceof Error ? error.message : String(error)}`,
        backendRefusal: false,
      }
    }

    if (Date.now() - start >= updateProbeTimeoutMs)
      break
    await sleep(updateProbeIntervalMs)
  }

  return {
    success: false,
    attempt,
    reason: lastReason,
    backendRefusal: false,
  }
}

export function explainCommonUpdateError(result: Extract<UpdateProbePollResult, { success: false }>): string[] {
  if (!result.errorCode)
    return []

  if (result.errorCode === 'disable_auto_update_to_major') {
    const blockedVersion = typeof result.extra?.version === 'string' ? result.extra.version : 'unknown'
    const oldVersion = typeof result.extra?.old === 'string' ? result.extra.old : 'unknown'
    return [
      'This is a backend refusal, not cache lag: the updates endpoint responded and blocked this update.',
      `Channel policy blocks major upgrades. Target bundle ${blockedVersion} is considered a major upgrade from device version_build ${oldVersion}.`,
      'Set CapacitorUpdater.version in capacitor.config.* to the installed native app version, then rebuild/reinstall the native app.',
      'Or adjust channel auto-update policy if major updates should be allowed.',
    ]
  }

  if (result.errorCode === 'disable_auto_update_to_metadata') {
    return [
      'Channel policy uses min_update_version metadata and this device is below the required minimum.',
      'Set CapacitorUpdater.version to the real installed native version or change channel min update constraints.',
    ]
  }

  if (result.errorCode === 'disable_auto_update_to_minor') {
    return [
      'Channel policy blocks minor upgrades for this device version.',
      'Use a bundle within allowed minor range or relax the channel auto-update policy.',
    ]
  }

  if (result.errorCode === 'disable_auto_update_to_patch') {
    return [
      'Channel policy blocks patch upgrades for this device version.',
      'Use a bundle within allowed patch range or relax the channel auto-update policy.',
    ]
  }

  if (result.errorCode === 'disable_auto_update_under_native') {
    return [
      'The channel disallows downgrading below the native app version.',
      'Upload a bundle >= native version or disable the "under native" protection for this channel.',
    ]
  }

  if (result.errorCode === 'misconfigured_channel') {
    return [
      'Channel is configured with disable_auto_update=version_number but missing min_update_version metadata.',
      'Set a valid minimum update version for this channel or change the disable_auto_update mode.',
    ]
  }

  if (result.errorCode === 'cannot_update_via_private_channel') {
    return [
      'The request resolved to a private channel that does not allow device self-association.',
      'Configure defaultChannel to a channel with device self-association enabled, or use a public channel.',
    ]
  }

  if (result.errorCode === 'semver_error') {
    return [
      'The version_build sent to the backend is not a valid semver value.',
      'Set CapacitorUpdater.version to a valid semver like x.y.z and rebuild the native app.',
    ]
  }

  if (result.errorCode === 'unknown_version_build') {
    return [
      'The backend received version_build=unknown and cannot evaluate update rules.',
      'Ensure CapacitorUpdater.version is configured or native version parsing resolves correctly.',
    ]
  }

  if (result.errorCode === 'unsupported_plugin_version') {
    return [
      'The backend rejects this plugin version for update checks.',
      'Upgrade @capgo/capacitor-updater in the app and rebuild native before retrying.',
    ]
  }

  if (result.errorCode === 'key_id_mismatch') {
    return [
      'Bundle encryption key and device key_id do not match.',
      'Use the same public key/key_id in app config and bundle encryption settings, then republish.',
    ]
  }

  if (result.errorCode === 'disabled_platform_ios' || result.errorCode === 'disabled_platform_android' || result.errorCode === 'disabled_platform_electron') {
    return [
      'This channel has updates disabled for the current platform.',
      'Enable the platform toggle on the target channel.',
    ]
  }

  if (result.errorCode === 'disable_prod_build' || result.errorCode === 'disable_dev_build') {
    return [
      'This channel blocks updates for this build type (prod/dev).',
      'Adjust channel allow_prod/allow_dev settings or test with a matching build type.',
    ]
  }

  if (result.errorCode === 'disable_device' || result.errorCode === 'disable_emulator') {
    return [
      'This channel blocks updates for this runtime target (device/emulator).',
      'Adjust channel allow_device/allow_emulator settings or test on the allowed target.',
    ]
  }

  if (result.errorCode === 'no_channel' || result.errorCode === 'null_channel_data') {
    return [
      'No usable channel assignment was resolved for this device.',
      'Set a default channel in CapacitorUpdater.defaultChannel or ensure channel override/default exists for this app.',
    ]
  }

  if (result.errorCode === 'missing_info') {
    return [
      'The updates request was missing required identifiers (app/device/version/platform).',
      'Verify request payload contract and CapacitorUpdater app configuration.',
    ]
  }

  if (result.errorCode === 'no_bundle' || result.errorCode === 'no_bundle_url' || result.errorCode === 'no_url_or_manifest') {
    return [
      'Backend resolved a target version but could not provide a downloadable artifact.',
      'Verify bundle upload integrity, channel assignment, and storage URL/manifest availability.',
    ]
  }

  if (result.errorCode === 'already_on_builtin') {
    return [
      'Server resolved builtin as target and device is already on builtin bundle.',
      'Publish and assign a non-builtin target bundle if you expect an OTA update.',
    ]
  }

  if (result.errorCode === 'revert_to_builtin_plugin_version_too_old') {
    return [
      'Backend requested builtin revert but plugin version is too old to handle this flow safely.',
      'Upgrade @capgo/capacitor-updater and rebuild native app.',
    ]
  }

  if (result.errorCode === 'on_premise_app') {
    return [
      'This app is flagged as on-premise and cloud updates endpoint is intentionally blocked.',
      'Use your on-prem update endpoint/configuration instead of plugin.capgo.app.',
    ]
  }

  if (result.errorCode === 'need_plan_upgrade') {
    return [
      'Update checks are blocked by current plan limits.',
      'Upgrade plan or contact organization admin to restore OTA access.',
    ]
  }

  if (result.errorCode === 'invalid_json_body' || result.errorCode === 'invalid_query_parameters') {
    return [
      'Updates endpoint rejected request shape/field types.',
      'Verify payload contract: app_id, device_id, version_name, version_build, platform, plugin_version, is_prod, is_emulator.',
    ]
  }

  return [
    `Backend returned ${result.errorCode}.`,
    'Check channel restrictions, app/plugin configuration, and device version values in the request payload.',
  ]
}
