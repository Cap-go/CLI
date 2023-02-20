import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { Table } from 'console-table-printer';
import { Database } from 'types/supabase.types';
import { convertAppName, formatError, getHumanDate } from '../utils';

export const checkVersionNotUsedInChannel = async (supabase: SupabaseClient<Database>,
  appid: string, userId: string, versionData: Database['public']['Tables']['app_versions']['Row']) => {
  const { data: channelFound, error: errorChannel } = await supabase
    .from('channels')
    .select()
    .eq('app_id', appid)
    .eq('created_by', userId)
    .eq('version', versionData.id)
  if (errorChannel)
    program.error(`Cannot check Version ${appid}@${versionData.name} ${formatError(errorChannel)}`);
  if (channelFound && channelFound.length > 0) {
    const appidWeb = convertAppName(appid)
    program.error(`❌ Version ${appid}@${versionData.name} is used in channel ${channelFound[0].name}, unlink it first:
https://web.capgo.app/app/p/${appidWeb}/channel/${channelFound[0].id}
Click on top right button and unlink.
${formatError(errorChannel)}`);
  }
}

export const findUnknownVersion = (supabase: SupabaseClient<Database>, appId: string) => supabase
  .from('app_versions')
  .select('id')
  .eq('app_id', appId)
  .eq('name', 'unknown')
  .single()


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
  .eq('user_id', userId)
  .single()


export const displayChannels = (data: (Database['public']['Tables']['channels']['Row'] & { keep?: string })[]) => {
  const p = new Table({
    title: "Channels",
    charLength: { "❌": 2, "✅": 2 },
  });

  // add rows with color
  data.reverse().forEach(row => {
    p.addRow({
      Name: row.name,
      Created: getHumanDate(row.created_at),
      Public: row.public ? '✅' : '❌'
    });
  });

  p.printTable();
}

export const getActiveChannels = async (supabase: SupabaseClient<Database>, appid: string, userId: string) => {
  const { data, error: vError } = await supabase
    .from('channels')
    .select()
    .eq('app_id', appid)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (vError) {
    program.error(`App ${appid} not found in database ${formatError(vError)} `);
  }
  return data;
}