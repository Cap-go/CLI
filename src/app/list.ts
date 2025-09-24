import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase.types'
import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { Table } from '@sauber/table'
import { program } from 'commander'
import { checkAlerts } from '../api/update'
import { createSupabaseClient, findSavedKey, getHumanDate, verifyUser } from '../utils'

function displayApp(data: Database['public']['Tables']['apps']['Row'][]) {
  if (!data.length) {
    log.error('No apps found')
    exit(1)
  }
  const t = new Table()
  t.headers = ['Name', 'id', 'Created']
  t.rows = []

  // add rows with color
  for (const row of data.toReversed()) {
    t.rows.push([row.name ?? '', row.app_id, getHumanDate(row.created_at)])
  }

  log.success('Apps')
  log.success(t.toString())
}

export async function getActiveApps(supabase: SupabaseClient<Database>) {
  const { data, error: vError } = await supabase
    .from('apps')
    .select()
    // .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (vError) {
    log.error('Apps not found')
    program.error('')
  }
  return data
}

export async function listApp(options: OptionsBase) {
  intro(`List apps in Capgo`)

  await checkAlerts()
  options.apikey = options.apikey || findSavedKey()

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)

  await verifyUser(supabase, options.apikey, ['write', 'all', 'read', 'upload'])

  log.info(`Getting active bundle in Capgo`)

  // Get all active app versions we might possibly be able to cleanup
  const allApps = await getActiveApps(supabase)

  log.info(`Active app in Capgo: ${allApps?.length}`)

  displayApp(allApps)
  outro(`Done ✅`)
  exit()
}
