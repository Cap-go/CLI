import type { OptionsBase } from '../utils'
import { log } from '@clack/prompts'
import { check2FAComplianceForApp, checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import {
  checkCompatibilityCloud,
  createSupabaseClient,
  findSavedKey,
  formatError,
  getAppId,
  getConfig,
  isCompatible,
  OrganizationPerm,
  verifyUser,
} from '../utils'

interface Options extends OptionsBase {
  channel?: string
  packageJson?: string
  nodeModules?: string
}

interface ReleaseTypeResult {
  releaseType: 'native' | 'OTA'
  resolvedAppId: string
  channel: string
}

export async function getReleaseType(appId: string, options: Options): Promise<ReleaseTypeResult> {
  const enrichedOptions: Options = {
    ...options,
    apikey: options.apikey || findSavedKey(),
  }

  const extConfig = await getConfig()
  const resolvedAppId = getAppId(appId, extConfig?.config)
  const channel = enrichedOptions.channel

  if (!channel) {
    log.error('Missing argument, you need to provide a channel')
    throw new Error('Missing channel')
  }

  if (!enrichedOptions.apikey) {
    log.error('Missing API key, you need to provide an API key to upload your bundle')
    throw new Error('Missing API key')
  }

  if (!resolvedAppId) {
    log.error('Missing argument, you need to provide an appId, or be in a capacitor project')
    throw new Error('Missing appId')
  }

  const supabase = await createSupabaseClient(
    enrichedOptions.apikey,
    enrichedOptions.supaHost,
    enrichedOptions.supaAnon,
  )

  await check2FAComplianceForApp(supabase, resolvedAppId, false)
  await verifyUser(supabase, enrichedOptions.apikey, ['write', 'all', 'read', 'upload'])
  await checkAppExistsAndHasPermissionOrgErr(
    supabase,
    enrichedOptions.apikey,
    resolvedAppId,
    OrganizationPerm.read,
    false,
    true,
  )

  const compatibility = await checkCompatibilityCloud(
    supabase,
    resolvedAppId,
    channel,
    enrichedOptions.packageJson,
    enrichedOptions.nodeModules,
  )

  const hasIncompatible = compatibility.finalCompatibility.some(entry => !isCompatible(entry))
  return {
    releaseType: hasIncompatible ? 'native' : 'OTA',
    resolvedAppId,
    channel,
  }
}

export async function printReleaseType(appId: string, options: Options) {
  try {
    const { releaseType, resolvedAppId, channel } = await getReleaseType(appId, options)
    const lines = releaseType === 'OTA'
      ? [
          'Recommendation: OTA',
          `Run: npx @capgo/cli@latest bundle upload ${resolvedAppId} --channel ${channel}`,
        ]
      : [
          'Recommendation: native',
          `Save credentials: npx @capgo/cli@latest build credentials save --appId ${resolvedAppId} --platform <ios|android>`,
          `Request build: npx @capgo/cli@latest build request ${resolvedAppId} --platform <ios|android> --path .`,
        ]
    process.stdout.write(`${lines.join('\n')}\n`)
  }
  catch (error) {
    log.error(`Error checking release type ${formatError(error)}`)
    throw error
  }
}
