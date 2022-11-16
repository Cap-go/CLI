import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { AppVersion } from './versions';
import { definitions } from '../bin/types_supabase';
import { formatError } from '../bin/utils';

export async function checkVersionNotUsedInChannel(supabase: SupabaseClient, appid: string, userId: string, versionData: AppVersion, bundle: string) {
  const { data: channelFound, error: errorChannel } = await supabase
    .from<definitions['channels']>('channels')
    .select()
    .eq('app_id', appid)
    .eq('created_by', userId)
    .eq('version', versionData.id);
  if ((channelFound && channelFound.length) || errorChannel) {
    program.error(`Version ${appid}@${bundle} is used in a channel, unlink it first ${formatError(errorChannel)}`);
  }
}