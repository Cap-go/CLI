import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { Database } from 'types/supabase.types';
// import { definitions } from '../types/types_supabase';
import { convertAppName, formatError } from '../bin/utils';

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