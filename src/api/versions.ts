import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase.types'
import { exit } from 'node:process'
import { log } from '@clack/prompts'
import { Table } from '@sauber/table'
import { program } from 'commander'

// import { definitions } from '../types/types_supabase';
import { getHumanDate } from '../utils'
import { checkVersionNotUsedInChannel } from './channels'
import { checkVersionNotUsedInDeviceOverride } from './devices_override'

export async function deleteAppVersion(supabase: SupabaseClient<Database>, appid: string, bundle: string) {
  const { error: delAppSpecVersionError } = await supabase
    .from('app_versions')
    .update({
      deleted: true,
    })
    .eq('app_id', appid)
    .eq('deleted', false)
    .eq('name', bundle)
  if (delAppSpecVersionError) {
    log.error(`App Version ${appid}@${bundle} not found in database`)
    program.error('')
  }
}

export async function deleteSpecificVersion(supabase: SupabaseClient<Database>, appid: string, bundle: string) {
  const versionData = await getVersionData(supabase, appid, bundle)
  await checkVersionNotUsedInChannel(supabase, appid, versionData)
  await checkVersionNotUsedInDeviceOverride(supabase, appid, versionData)
  // Delete only a specific version in storage
  await deleteAppVersion(supabase, appid, bundle)
}

export function displayBundles(data: (Database['public']['Tables']['app_versions']['Row'] & { keep?: string })[]) {
  if (!data.length) {
    log.error('No bundle found')

    exit(1)
  }
  const t = new Table()
  t.theme = Table.roundTheme
  t.headers = ['Version', 'Created', 'Keep']

  // add rows with color
  data.reverse().forEach((row) => {
    t.rows.push([
      row.name,
      getHumanDate(row.created_at),
      row.keep != null ? row.keep : '',
    ])
  })

  log.success('Bundles')
  log.success(t.toString())
}

export async function getActiveAppVersions(supabase: SupabaseClient<Database>, appid: string) {
  const { data, error: vError } = await supabase
    .from('app_versions')
    .select()
    .eq('app_id', appid)
    .eq('deleted', false)
    .order('created_at', { ascending: false })

  if (vError) {
    log.error(`App ${appid} not found in database`)
    program.error('')
  }
  return data
}

export async function getChannelsVersion(supabase: SupabaseClient<Database>, appid: string) {
  // get all channels versionID
  const { data: channels, error: channelsError } = await supabase
    .from('channels')
    .select('version')
    .eq('app_id', appid)

  if (channelsError) {
    log.error(`App ${appid} not found in database`)
    program.error('')
  }
  return channels.map(c => c.version)
}

export async function getVersionData(supabase: SupabaseClient<Database>, appid: string, bundle: string) {
  const { data: versionData, error: versionIdError } = await supabase
    .from('app_versions')
    .select()
    .eq('app_id', appid)
    .eq('name', bundle)
    .eq('deleted', false)
    .single()
  if (!versionData || versionIdError) {
    log.error(`App Version ${appid}@${bundle} doesn't exist`)
    program.error('')
  }
  return versionData
}
