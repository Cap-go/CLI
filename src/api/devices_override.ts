import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { definitions } from '../types/types_supabase';
import { formatError } from '../bin/utils';

export const checkVersionNotUsedInDeviceOverride = async (supabase: SupabaseClient,
  appid: string, versionData: definitions["app_versions"], bundle: string) => {
  const { data: deviceFound, error: errorDevice } = await supabase
    .from<definitions['devices_override']>('devices_override')
    .select()
    .eq('app_id', appid)
    .eq('version', versionData.id);
  if ((deviceFound && deviceFound.length) || errorDevice) {
    program.error(`Version ${appid} @${bundle} is used in a device override, unlink it first ${formatError(errorDevice)}`);
  }
}