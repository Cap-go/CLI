import type { OptionsBase, Organization } from '../utils'
import { intro, log, outro } from '@clack/prompts'
import { Table } from '@sauber/table'
import { checkAlerts } from '../api/update'
import {
  createSupabaseClient,
  findSavedKey,
  formatError,
  verifyUser,
} from '../utils'

function displayOrganizations(data: Organization[], silent: boolean) {
  if (silent)
    return

  if (!data.length) {
    log.error('No organizations found')
    return
  }

  const t = new Table()
  t.headers = ['Name', 'ID', 'Role', 'Apps']
  t.rows = []

  for (const row of data.toReversed()) {
    t.rows.push([
      row.name ?? 'Unknown',
      row.gid,
      row.role,
      row.app_count?.toString() || '0',
    ])
  }

  log.success('Organizations')
  log.success(t.toString())
}

export async function listOrganizationsInternal(options: OptionsBase, silent = false) {
  if (!silent)
    intro('List organizations')

  await checkAlerts()

  const enrichedOptions: OptionsBase = {
    ...options,
    apikey: options.apikey || findSavedKey(),
  }

  if (!enrichedOptions.apikey) {
    if (!silent)
      log.error('Missing API key, you need to provide an API key to list organizations')
    throw new Error('Missing API key')
  }

  const supabase = await createSupabaseClient(
    enrichedOptions.apikey,
    enrichedOptions.supaHost,
    enrichedOptions.supaAnon,
  )
  await verifyUser(supabase, enrichedOptions.apikey, ['read', 'write', 'all'])

  if (!silent)
    log.info('Getting organizations from Capgo')

  const { error, data: allOrganizations } = await supabase.rpc('get_orgs_v6')

  if (error) {
    if (!silent)
      log.error(`Cannot get organizations ${formatError(error)}`)
    throw new Error(`Cannot get organizations: ${formatError(error)}`)
  }

  const organizations = allOrganizations || []

  if (!silent) {
    log.info(`Organizations found: ${organizations.length}`)
    displayOrganizations(organizations, silent)
    outro('Done ✅')
  }

  return organizations
}

export async function listOrganizations(options: OptionsBase) {
  await listOrganizationsInternal(options, false)
}
