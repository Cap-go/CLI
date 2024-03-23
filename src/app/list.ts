import process from 'node:process'
import { program } from 'commander'
import { Table } from 'console-table-printer'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as p from '@clack/prompts'
import type { Database } from '../types/supabase.types'
import type { OptionsBase } from '../utils'
import { createSupabaseClient, findSavedKey, getHumanDate, verifyUser } from '../utils'
import { checkLatest } from '../api/update'

function displayApp(data: Database['public']['Tables']['apps']['Row'][]) {
  if (!data.length) {
    p.log.error('No apps found')
    process.exit(1)
  }
  const t = new Table({
    title: 'Apps',
    charLength: { '❌': 2, '✅': 2 },
  })

  // add rows with color
  data.reverse().forEach((row) => {
    t.addRow({
      Name: row.name,
      id: row.app_id,
      Created: getHumanDate(row.created_at),
    })
  })

  p.log.success(t.render())
}

export async function getActiveApps(supabase: SupabaseClient<Database>) {
  const { data, error: vError } = await supabase
    .from('apps')
    .select()
    // .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (vError) {
    p.log.error('Apps not found')
    program.error('')
  }
  return data
}

export async function listApp(options: OptionsBase) {
  p.intro(`List apps in Capgo`)

  await checkLatest()
  options.apikey = options.apikey || findSavedKey()

  const supabase = await createSupabaseClient(options.apikey)

  await verifyUser(supabase, options.apikey, ['write', 'all', 'read', 'upload'])

  p.log.info(`Getting active bundle in Capgo`)

  // Get all active app versions we might possibly be able to cleanup
  const allApps = await getActiveApps(supabase)

  p.log.info(`Active app in Capgo: ${allApps?.length}`)

  displayApp(allApps)
  p.outro(`Done ✅`)
  process.exit()
}
