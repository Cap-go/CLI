import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { Table } from 'console-table-printer';
import * as p from '@clack/prompts';
import { Database } from '../types/supabase.types';
import { formatError, getHumanDate } from '../utils';

export const checkVersionNotUsedInChannel = async (supabase: SupabaseClient<Database>,
  appid: string, userId: string, versionData: Database['public']['Tables']['app_versions']['Row']) => {
  const { data: channelFound, error: errorChannel } = await supabase
    .from('channels')
    .select()
    .eq('app_id', appid)
    .eq('created_by', userId)
    .eq('version', versionData.id)
  if (errorChannel) {
    p.log.error(`Cannot check Version ${appid}@${versionData.name}`);
    program.error('');
  }
  if (channelFound && channelFound.length > 0) {
    p.intro(`❌ Version ${appid}@${versionData.name} is used in ${channelFound.length} channel`)
    if (await p.confirm({ message: 'unlink it?' })) {
      // loop on all channels and set version to unknown
      for (const channel of channelFound) {
        const s = p.spinner();
        s.start(`Unlinking channel ${channel.name}`)
        const { error: errorChannelUpdate } = await supabase
          .from('channels')
          .update({
            version: (await findUnknownVersion(supabase, appid))?.id
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
      p.log.error(`Unlink it first`);
      program.error('');
    }
    p.outro(`Version unlinked from ${channelFound.length} channel`)
  }
}

export const findUnknownVersion = (supabase: SupabaseClient<Database>, appId: string) => supabase
  .from('app_versions')
  .select('id')
  .eq('app_id', appId)
  .eq('name', 'unknown')
  .throwOnError()
  .single().then(({ data }) => data)


export const createChannel = (supabase: SupabaseClient<Database>, update: Database['public']['Tables']['channels']['Insert']) => supabase
  .from('channels')
  .insert(update)
  .select()
  .single()

export const delChannel = (supabase: SupabaseClient<Database>, name: string, appId: string, userId: string) => supabase
  .from('channels')
  .delete()
  .eq('name', name)
  .eq('app_id', appId)
  .eq('created_by', userId)
  .single()


export const displayChannels = (data: (Database['public']['Tables']['channels']['Row'] & { keep?: string })[]) => {
  const t = new Table({
    title: "Channels",
    charLength: { "❌": 2, "✅": 2 },
  });

  // add rows with color
  data.reverse().forEach(row => {
    t.addRow({
      Name: row.name,
      Created: getHumanDate(row.created_at),
      Public: row.public ? '✅' : '❌'
    });
  });

  p.log.success(t.render());
}

export const getActiveChannels = async (supabase: SupabaseClient<Database>, appid: string) => {
  const { data, error: vError } = await supabase
    .from('channels')
    .select()
    .eq('app_id', appid)
    // .eq('created_by', userId)
    .order('created_at', { ascending: false });

  if (vError) {
    p.log.error(`App ${appid} not found in database`);
    program.error('');
  }
  return data;
}
