import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { getPlatformDirFromCapacitorConfig } from '../build/platform-paths'
import { getAppId, getInstalledVersion } from '../utils'

const defaultUpdateUrl = 'https://plugin.capgo.app/updates'
export const updateProbeDeviceId = '00000000-0000-0000-0000-000000000000'
const updateProbeTimeoutMs = 60_000
const updateProbeIntervalMs = 5_000

/**
 * Full troubleshooting reference for common update failure codes.
 * Maintained in the Capgo website repo (Cap-go/website) at:
 *   src/content/docs/docs/plugins/updater/commonProblems.mdx
 */
const commonProblemsDocsUrl = 'https://capgo.app/docs/plugins/updater/commonproblems/'

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

function extractExtra(json: any): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  if (json && typeof json === 'object') {
    for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
      if (key !== 'error' && key !== 'message')
        extra[key] = value
    }
  }
  return extra
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
    return {
      status: 'failed',
      detail: `${error}: ${message ?? 'Unknown backend message'}`,
      errorCode: error,
      backendMessage: message,
      extra: extractExtra(json),
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
        // Transient server errors (5xx) are retryable during the poll window
        if (response.status >= 500) {
          lastReason = `HTTP ${response.status}: ${JSON.stringify(json)}`
          if (Date.now() - start >= updateProbeTimeoutMs)
            break
          await sleep(updateProbeIntervalMs)
          continue
        }
        const errorCode = typeof json?.error === 'string' ? json.error : undefined
        const backendMessage = typeof json?.message === 'string' ? json.message : undefined
        return {
          success: false,
          attempt,
          reason: `HTTP ${response.status}: ${JSON.stringify(json)}`,
          backendRefusal: !!errorCode,
          errorCode,
          backendMessage,
          extra: extractExtra(json),
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
      // Network errors are transient — keep retrying within the poll window
      lastReason = `Network error: ${error instanceof Error ? error.message : String(error)}`
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

/**
 * Brief CLI hints for recognized error codes.
 * One-liner cause + quick-fix. Full remediation details live in the website
 * docs page linked by {@link commonProblemsDocsUrl}.
 */
const errorHints: Record<string, { cause: string, fix: string }> = {
  disable_auto_update_to_major: {
    cause: 'Channel policy blocks major upgrades.',
    fix: 'Set CapacitorUpdater.version to the installed native version (e.g. 1.0.0), run cap sync, and reinstall the native build.',
  },
  disable_auto_update_to_minor: {
    cause: 'Channel policy blocks minor upgrades.',
    fix: 'Upload a bundle within the allowed minor range or relax the channel auto-update policy.',
  },
  disable_auto_update_to_patch: {
    cause: 'Channel policy blocks patch upgrades.',
    fix: 'Upload a bundle within the allowed patch range or relax the channel auto-update policy.',
  },
  disable_auto_update_to_metadata: {
    cause: 'Channel uses min_update_version metadata and this device baseline is below the minimum.',
    fix: 'Align CapacitorUpdater.version with the installed native version or adjust min_update_version.',
  },
  disable_auto_update_under_native: {
    cause: 'Channel prevents downgrades below the native app version.',
    fix: 'Upload a bundle >= native version or disable the under-native protection.',
  },
  misconfigured_channel: {
    cause: 'Channel has disable_auto_update=version_number but missing min_update_version.',
    fix: 'Set a valid min_update_version or change the disable_auto_update mode.',
  },
  cannot_update_via_private_channel: {
    cause: 'Selected channel does not allow device self-assignment.',
    fix: 'Use a channel with self-assignment enabled, or make it public.',
  },
  semver_error: {
    cause: 'version_build sent to the backend is not valid semver.',
    fix: 'Set CapacitorUpdater.version to a valid semver (x.y.z) and rebuild native.',
  },
  unknown_version_build: {
    cause: 'Backend received version_build=unknown.',
    fix: 'Configure CapacitorUpdater.version or verify native version parsing.',
  },
  unsupported_plugin_version: {
    cause: 'Plugin version is too old for this backend.',
    fix: 'Upgrade @capgo/capacitor-updater and rebuild native.',
  },
  key_id_mismatch: {
    cause: 'Bundle encryption key and device key differ.',
    fix: 'Use the same public key across app config and bundle encryption, then republish.',
  },
  disabled_platform_ios: {
    cause: 'Channel has iOS updates disabled.',
    fix: 'Enable the iOS toggle on the target channel.',
  },
  disabled_platform_android: {
    cause: 'Channel has Android updates disabled.',
    fix: 'Enable the Android toggle on the target channel.',
  },
  disabled_platform_electron: {
    cause: 'Channel has Electron updates disabled.',
    fix: 'Enable the Electron toggle on the target channel.',
  },
  disable_prod_build: {
    cause: 'Channel blocks production builds.',
    fix: 'Adjust channel allow_prod setting or test with a dev build.',
  },
  disable_dev_build: {
    cause: 'Channel blocks development builds.',
    fix: 'Adjust channel allow_dev setting or test with a prod build.',
  },
  disable_device: {
    cause: 'Channel blocks physical devices.',
    fix: 'Adjust channel allow_device setting or test on emulator.',
  },
  disable_emulator: {
    cause: 'Channel blocks emulators.',
    fix: 'Adjust channel allow_emulator setting or test on a physical device.',
  },
  no_channel: {
    cause: 'No channel was resolved for this device.',
    fix: 'Set defaultChannel in config or ensure a channel default/override exists.',
  },
  null_channel_data: {
    cause: 'No usable channel data found.',
    fix: 'Set defaultChannel in config or ensure a channel default/override exists.',
  },
  missing_info: {
    cause: 'Request missing required identifiers (app/device/version/platform).',
    fix: 'Verify CapacitorUpdater config and request payload.',
  },
  no_bundle: {
    cause: 'Backend resolved a version but no downloadable artifact exists.',
    fix: 'Verify bundle upload integrity and channel assignment.',
  },
  no_bundle_url: {
    cause: 'Bundle resolved but URL is missing.',
    fix: 'Check storage configuration and bundle upload.',
  },
  no_url_or_manifest: {
    cause: 'Bundle resolved but no URL or manifest available.',
    fix: 'Check storage configuration and bundle upload.',
  },
  already_on_builtin: {
    cause: 'Device is already on the builtin bundle.',
    fix: 'Publish and assign a non-builtin bundle for OTA updates.',
  },
  revert_to_builtin_plugin_version_too_old: {
    cause: 'Plugin version is too old for safe builtin revert.',
    fix: 'Upgrade @capgo/capacitor-updater and rebuild native.',
  },
  on_premise_app: {
    cause: 'App is flagged as on-premise; cloud endpoint is blocked.',
    fix: 'Use your on-prem update endpoint instead of plugin.capgo.app.',
  },
  need_plan_upgrade: {
    cause: 'Update checks blocked by plan limits.',
    fix: 'Upgrade plan or contact organization admin.',
  },
  invalid_json_body: {
    cause: 'Updates endpoint rejected the request body.',
    fix: 'Verify payload contract (app_id, device_id, version_name, version_build, platform, plugin_version).',
  },
  invalid_query_parameters: {
    cause: 'Updates endpoint rejected query parameters.',
    fix: 'Verify request format matches the expected contract.',
  },
}

export function explainCommonUpdateError(result: Extract<UpdateProbePollResult, { success: false }>): string[] {
  if (!result.errorCode)
    return []

  const hints: string[] = []

  // Special context for major-block errors
  if (result.errorCode === 'disable_auto_update_to_major') {
    const blockedVersion = typeof result.extra?.version === 'string' ? result.extra.version : 'unknown'
    const oldVersion = typeof result.extra?.old === 'string' ? result.extra.old : 'unknown'
    hints.push(`Channel policy blocks major upgrades (target ${blockedVersion}, device baseline ${oldVersion}).`)
  }

  const known = errorHints[result.errorCode]
  if (known) {
    hints.push(known.cause)
    hints.push(`Fix: ${known.fix}`)
  }
  else {
    hints.push(`Backend returned ${result.errorCode}.`)
    hints.push('Check channel restrictions, app/plugin configuration, and device version values.')
  }

  hints.push(`Full troubleshooting guide: ${commonProblemsDocsUrl}`)
  return hints
}
