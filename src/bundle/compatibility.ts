import type { OptionsBase } from '../utils'
import { intro, log } from '@clack/prompts'
import { Table } from '@sauber/table'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import {
  checkCompatibility,
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
  text?: boolean
  packageJson?: string
  nodeModules?: string
}

interface CompatibilityResult {
  finalCompatibility: Awaited<ReturnType<typeof checkCompatibility>>['finalCompatibility']
}

export async function checkCompatibilityCommandInternal(
  appId: string,
  options: Options,
  silent = false,
): Promise<CompatibilityResult> {
  if (!silent)
    intro('Check compatibility')

  const enrichedOptions: Options = {
    ...options,
    apikey: options.apikey || findSavedKey(),
  }

  const extConfig = await getConfig()
  const resolvedAppId = getAppId(appId, extConfig?.config)
  const channel = enrichedOptions.channel

  if (!channel) {
    if (!silent)
      log.error('Missing argument, you need to provide a channel')
    throw new Error('Missing channel')
  }

  if (!enrichedOptions.apikey) {
    if (!silent)
      log.error('Missing API key, you need to provide an API key to upload your bundle')
    throw new Error('Missing API key')
  }

  if (!resolvedAppId) {
    if (!silent)
      log.error('Missing argument, you need to provide an appId, or be in a capacitor project')
    throw new Error('Missing appId')
  }

  const supabase = await createSupabaseClient(
    enrichedOptions.apikey,
    enrichedOptions.supaHost,
    enrichedOptions.supaAnon,
  )

  await verifyUser(supabase, enrichedOptions.apikey, ['write', 'all', 'read', 'upload'])
  await checkAppExistsAndHasPermissionOrgErr(
    supabase,
    enrichedOptions.apikey,
    resolvedAppId,
    OrganizationPerm.read,
    silent,
  )

  const compatibility = await checkCompatibility(
    supabase,
    resolvedAppId,
    channel,
    enrichedOptions.packageJson,
    enrichedOptions.nodeModules,
  )

  if (!silent) {
    const table = new Table()
    table.headers = ['Package', 'Local version', 'Remote version', 'Compatible']
    table.theme = Table.roundTheme
    table.rows = []

    const yesSymbol = enrichedOptions.text ? 'Yes' : '✅'
    const noSymbol = enrichedOptions.text ? 'No' : '❌'

    for (const entry of compatibility.finalCompatibility) {
      const { name, localVersion, remoteVersion } = entry
      const compatible = isCompatible(entry) ? yesSymbol : noSymbol
      table.rows.push([name, localVersion, remoteVersion, compatible])
    }

    log.success('Compatibility')
    log.success(table.toString())
  }

  return {
    finalCompatibility: compatibility.finalCompatibility,
  }
}

export async function checkCompatibilityCommand(appId: string, options: Options) {
  try {
    await checkCompatibilityCommandInternal(appId, options, false)
  }
  catch (error) {
    log.error(`Error checking compatibility ${formatError(error)}`)
    throw error
  }
}
