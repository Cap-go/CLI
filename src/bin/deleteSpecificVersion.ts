import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { definitions } from './types_supabase';
import { formatError } from './utils';

export async function deleteSpecificVersion(supabase: SupabaseClient, appid: string, userId: string, bundle: string) {
  const { data: versionData, error: versionIdError } = await supabase
    .from<definitions['app_versions']>('app_versions')
    .select()
    .eq('app_id', appid)
    .eq('user_id', userId)
    .eq('name', bundle)
    .eq('deleted', false)
    .single();
  if (!versionData || versionIdError) {
    program.error(`Version ${appid}@${bundle} doesn't exist ${formatError(versionIdError)}`);
  }
  const { data: channelFound, error: errorChannel } = await supabase
    .from<definitions['channels']>('channels')
    .select()
    .eq('app_id', appid)
    .eq('created_by', userId)
    .eq('version', versionData.id);
  if ((channelFound && channelFound.length) || errorChannel) {
    program.error(`Version ${appid}@${bundle} is used in a channel, unlink it first ${formatError(errorChannel)}`);
  }
  const { data: deviceFound, error: errorDevice } = await supabase
    .from<definitions['devices_override']>('devices_override')
    .select()
    .eq('app_id', appid)
    .eq('version', versionData.id);
  if ((deviceFound && deviceFound.length) || errorDevice) {
    program.error(`Version ${appid} @${bundle} is used in a device override, unlink it first ${formatError(errorDevice)}`);
  }
  // Delete only a specific version in storage
  const { error: delError } = await supabase
    .storage
    .from('apps')
    .remove([`${userId}/${appid}/versions/${versionData.bucket_id} `]);
  if (delError) {
    program.error(`Something went wrong when trying to delete ${appid} @${bundle} ${delError} `);
  }

  const { error: delAppSpecVersionError } = await supabase
    .from<definitions['app_versions']>('app_versions')
    .update({
      deleted: true
    })
    .eq('app_id', appid)
    .eq('user_id', userId)
    .eq('name', bundle);
  if (delAppSpecVersionError) {
    program.error(`App ${appid}@${bundle} not found in database '${delAppSpecVersionError}'`);
  }
}