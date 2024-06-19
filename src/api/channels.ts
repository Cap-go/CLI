import process from 'node:process'
import type { SupabaseClient } from '@supabase/supabase-js'
import { program } from 'commander'
import { Table } from 'console-table-printer'
import * as p from '@clack/prompts'
import type { Database } from '../types/supabase.types'
import { formatError } from '../utils'

export async function checkVersionNotUsedInChannel(supabase: SupabaseClient<Database>, appid: string, versionData: Database['public']['Tables']['app_versions']['Row']) {
  const { data: channelFound, error: errorChannel } = await supabase
    .from('channels')
    .select()
    .eq('app_id', appid)
    .eq('version', versionData.id)
  if (errorChannel) {
    p.log.error(`Cannot check Version ${appid}@${versionData.name}`)
    program.error('')
  }
  if (channelFound && channelFound.length > 0) {
    p.intro(`❌ Version ${appid}@${versionData.name} is used in ${channelFound.length} channel`)
    if (await p.confirm({ message: 'unlink it?' })) {
      // loop on all channels and set version to unknown
      for (const channel of channelFound) {
        const s = p.spinner()
        s.start(`Unlinking channel ${channel.name}`)
        const { error: errorChannelUpdate } = await supabase
          .from('channels')
          .update({
            version: (await findUnknownVersion(supabase, appid))?.id,
          })
          .eq('id', channel.id)
        if (errorChannelUpdate) {
          s.stop(`Cannot update channel ${channel.name} ${formatError(errorChannelUpdate)}`)
          process.exit(1)
        }
        s.stop(`✅ Channel ${channel.name} unlinked`)
      }
    }
    else {
      p.log.error(`Unlink it first`)
      program.error('')
    }
    p.outro(`Version unlinked from ${channelFound.length} channel`)
  }
}

export function findUnknownVersion(supabase: SupabaseClient<Database>, appId: string) {
  return supabase
    .from('app_versions')
    .select('id')
    .eq('app_id', appId)
    .eq('name', 'unknown')
    .throwOnError()
    .single().then(({ data, error }) => {
      if (error) {
        p.log.error(`Cannot call findUnknownVersion as it returned an error.\n${formatError(error)}`)
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
  disableAutoUpdate: string
  disableAutoUpdateUnderNative: boolean
  allow_device_self_set: boolean
  enable_progressive_deploy: boolean
  secondaryVersionPercentage: number
  secondVersion?: version
  enableAbTesting: boolean
  allow_emulator: boolean
  allow_dev: boolean
  version?: version
}
export function displayChannels(data: Channel[]) {
  const t = new Table({
    title: 'Channels',
    charLength: { '❌': 2, '✅': 2 },
  })

  // add rows with color
  data.reverse().forEach((row) => {
    t.addRow({
      'Name': row.name,
      ...(row.version ? { Version: row.version.name } : undefined),
      'Public': row.public ? '✅' : '❌',
      'iOS': row.ios ? '✅' : '❌',
      'Android': row.android ? '✅' : '❌',
      '⬆️ limit': row.disableAutoUpdate,
      '⬇️ under native': row.disableAutoUpdateUnderNative ? '❌' : '✅',
      'Self assign': row.allow_device_self_set ? '✅' : '❌',
      'Progressive': row.enable_progressive_deploy ? '✅' : '❌',
      ...(row.enable_progressive_deploy && row.secondVersion ? { 'Next version': row.secondVersion.name } : undefined),
      ...(row.enable_progressive_deploy && row.secondVersion ? { 'Next %': row.secondaryVersionPercentage } : undefined),
      'AB Testing': row.enableAbTesting ? '✅' : '❌',
      ...(row.enableAbTesting && row.secondVersion ? { 'Version B': row.secondVersion } : undefined),
      ...(row.enableAbTesting && row.secondVersion ? { 'A/B %': row.secondaryVersionPercentage } : undefined),
      'Emulator': row.allow_emulator ? '✅' : '❌',
      'Dev 📱': row.allow_dev ? '✅' : '❌',
    })
  })

  p.log.success(t.render())
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
      disableAutoUpdateUnderNative,
      disableAutoUpdate,
      enable_progressive_deploy,
      enableAbTesting,
      secondaryVersionPercentage,
      secondVersion (id, name),
      created_at,
      created_by,
      app_id,
      version (id, name)
    `)
    .eq('app_id', appid)
    // .eq('created_by', userId)
    .order('created_at', { ascending: false })

  if (vError) {
    p.log.error(`App ${appid} not found in database`)
    program.error('')
  }
  return data as any as Channel[]
}
