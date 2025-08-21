import type { OptionsBase, Organization } from '../utils'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { Table } from '@sauber/table'
import { program } from 'commander'
import { checkAlerts } from '../api/update'
import {
  createSupabaseClient,
  findSavedKey,
  formatError,
  verifyUser,
} from '../utils'

function displayOrganizations(data: Organization[]) {
  if (!data.length) {
    log.error('No organizations found')
    return
  }
  const t = new Table()
  t.headers = ['Name', 'ID', 'Role', 'Apps']
  t.rows = []

  data.reverse().forEach((row) => {
    t.rows.push([
      row.name ?? 'Unknown',
      row.gid,
      row.role,
      row.app_count?.toString() || '0',
    ])
  })

  log.success('Organizations')
  log.success(t.toString())
}

export async function listOrganizations(options: OptionsBase) {
  intro(`List organizations`)

  await checkAlerts()
  options.apikey = options.apikey || findSavedKey()

  if (!options.apikey) {
    log.error('Missing API key, you need to provide an API key to list organizations')
    program.error('')
  }

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
  await verifyUser(supabase, options.apikey, ['read', 'write', 'all'])

  log.info('Getting organizations from Capgo')

  const { error, data: allOrganizations } = await supabase
    .rpc('get_orgs_v6')

  if (error) {
    log.error(`Cannot get organizations ${formatError(error)}`)
    program.error('')
  }

  log.info(`Organizations found: ${allOrganizations?.length || 0}`)
  displayOrganizations(allOrganizations || [])
  outro('Done ✅')
  exit()
}
