import { stdout } from 'node:process'
import type { OptionsBase } from '../utils'
import { log } from '@clack/prompts'
import { checkCompatibilityInternal } from './compatibility'
import { formatError } from '../utils'

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

/**
 * Determine whether a native build or OTA update is recommended.
 */
export async function getReleaseType(appId: string, options: Options): Promise<ReleaseTypeResult> {
  const compatibility = await checkCompatibilityInternal(appId, options, true)
  const hasIncompatible = compatibility.hasIncompatible
  return {
    releaseType: hasIncompatible ? 'native' : 'OTA',
    resolvedAppId: compatibility.resolvedAppId,
    channel: compatibility.channel,
  }
}

/**
 * Print the recommended release type and the relevant CLI commands.
 */
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
    stdout.write(`${lines.join('\n')}\n`)
  }
  catch (error) {
    log.error(`Error checking release type ${formatError(error)}`)
    throw error
  }
}
