import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { Database } from 'types/supabase.types';
import { convertAppName, formatError } from '../bin/utils';

export const checkVersionNotUsedInDeviceOverride = async (supabase: SupabaseClient,
  appid: string, versionData: Database['public']['Tables']['app_versions']['Row'], bundle: string) => {
  const { data: deviceFound, error: errorDevice } = await supabase
    .from('devices_override')
    .select()
    .eq('app_id', appid)
    .eq('version', versionData.id)
    .single();
  if (deviceFound || errorDevice) {
    const appidWeb = convertAppName(appid)
    program.error(`Version ${appid} @${bundle} is used in a device override, unlink it first
https://web.capgo.app/app/p/${appidWeb}/d/${deviceFound.device_id}
${formatError(errorDevice)}`);
  }
}