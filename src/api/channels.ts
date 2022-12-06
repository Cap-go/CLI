import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { Database } from 'types/supabase.types';
// import { definitions } from '../types/types_supabase';
import { convertAppName, formatError } from '../bin/utils';

export const checkVersionNotUsedInChannel = async (supabase: SupabaseClient,
  appid: string, userId: string, versionData: Database['public']['Tables']['app_versions']['Row'], bundle: string) => {
  const { data: channelFound, error: errorChannel } = await supabase
    .from('channels')
    .select()
    .eq('app_id', appid)
    .eq('created_by', userId)
    .eq('version', versionData.id)
    .single();
  if ((channelFound && channelFound.length) || errorChannel) {
    const appidWeb = convertAppName(appid)
    program.error(`Version ${appid}@${bundle} is used in a channel, unlink it first
https://web.capgo.app/app/p/${appidWeb}/channel/${channelFound.id}
${formatError(errorChannel)}`);
  }
}