import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase.types'
import { exit } from 'node:process'
import { confirm as confirmC, intro, log, outro, spinner } from '@clack/prompts'
import { Table } from '@sauber/table'
import { program } from 'commander'
import { formatError } from '../utils'

export async function checkVersionNotUsedInChannel(supabase: SupabaseClient<Database>, appid: string, versionData: Database['public']['Tables']['app_versions']['Row']) {
  const { data: channelFound, error: errorChannel } = await supabase
    .from('channels')
    .select()
    .eq('app_id', appid)
    .eq('version', versionData.id)
  if (errorChannel) {
    log.error(`Cannot check Version ${appid}@${versionData.name}`)
    program.error('')
  }
  if (channelFound && channelFound.length > 0) {
    intro(`❌ Version ${appid}@${versionData.name} is used in ${channelFound.length} channel`)
    if (await confirmC({ message: 'unlink it?' })) {
      // loop on all channels and set version to unknown
      for (const channel of channelFound) {
        const s = spinner()
        s.start(`Unlinking channel ${channel.name}`)
        const { error: errorChannelUpdate } = await supabase
          .from('channels')
          .update({
            version: (await findUnknownVersion(supabase, appid))?.id,
          })
          .eq('id', channel.id)
        if (errorChannelUpdate) {
          s.stop(`Cannot update channel ${channel.name} ${formatError(errorChannelUpdate)}`)
          exit(1)
        }
        s.stop(`✅ Channel ${channel.name} unlinked`)
      }
    }
    else {
      log.error(`Unlink it first`)
      program.error('')
    }
    outro(`Version unlinked from ${channelFound.length} channel`)
  }
}

export function findUnknownVersion(supabase: SupabaseClient<Database>, appId: string) {
  return supabase
    .from('app_versions')
    .select('id')
    .eq('app_id', appId)
    .eq('name', 'unknown')
    .throwOnError()
    .single()
    .then(({ data, error }) => {
      if (error) {
        log.error(`Cannot call findUnknownVersion as it returned an error.\n${formatError(error)}`)
        program.error('')
      }
      return data
    })
}

export function createChannel(supabase: SupabaseClient<Database>, update: Database['public']['Tables']['channels']['Insert']) {
  return supabase
    .from('channels')
    .insert(update)
    .select()
    .single()
}

export function delChannel(supabase: SupabaseClient<Database>, name: string, appId: string, _userId: string) {
  return supabase
    .from('channels')
    .delete()
    .eq('name', name)
    .eq('app_id', appId)
    .single()
}

export function findBundleIdByChannelName(supabase: SupabaseClient<Database>, appId: string, name: string) {
  return supabase
    .from('channels')
    .select(`
      id,
      version (id, name)
    `)
    .eq('app_id', appId)
    .eq('name', name)
    .single()
    .throwOnError()
    .then(({ data }) => {
      return data?.version
    })
}

interface version {
  id: string
  name: string
}

interface Channel {
  id: number
  name: string
  public: boolean
  ios: boolean
  android: boolean
  disable_auto_update: string
  disable_auto_update_under_native: boolean
  allow_device_self_set: boolean
  allow_emulator: boolean
  allow_dev: boolean
  version?: version
}
export function displayChannels(data: Channel[]) {
  const t = new Table()
  t.theme = Table.roundTheme
  t.headers = ['Name', 'Version', 'Public', 'iOS', 'Android', 'Auto Update', 'Native Auto Update', 'Device Self Set', 'Progressive Deploy', 'Secondary Version', 'Secondary Version Percentage', 'AB Testing', 'AB Testing Version', 'AB Testing Percentage', 'Emulator', 'Dev']
  t.rows = [
    ['a', 0, true],
    ['bb', 10, false],
  ]

  // add rows with color
  data.reverse().forEach((row) => {
    t.rows.push([
      row.name,
      row.version?.name,
      row.public ? '✅' : '❌',
      row.ios ? '✅' : '❌',
      row.android ? '✅' : '❌',
      row.disable_auto_update,
      row.disable_auto_update_under_native ? '❌' : '✅',
      row.allow_device_self_set ? '✅' : '❌',
      row.allow_emulator ? '✅' : '❌',
      row.allow_dev ? '✅' : '❌',
    ])
  })
  log.success('Channels')
  log.success(t.toString())
}

export async function getActiveChannels(supabase: SupabaseClient<Database>, appid: string) {
  const { data, error: vError } = await supabase
    .from('channels')
    .select(`
      id,
      name,
      public,
      allow_emulator,
      allow_dev,
      ios,
      android,
      allow_device_self_set,
      disable_auto_update_under_native,
      disable_auto_update,
      created_at,
      created_by,
      app_id,
      version (id, name)
    `)
    .eq('app_id', appid)
    // .eq('created_by', userId)
    .order('created_at', { ascending: false })

  if (vError) {
    log.error(`App ${appid} not found in database`)
    program.error('')
  }
  return data as any as Channel[]
}
