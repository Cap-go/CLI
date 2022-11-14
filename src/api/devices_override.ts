import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { AppVersion } from './versions';
import { definitions } from '../bin/types_supabase';
import { formatError } from '../bin/utils';

export async function checkVersionNotUsedInDeviceOverride(supabase: SupabaseClient, appid: string, versionData: AppVersion, bundle: string) {
  const { data: deviceFound, error: errorDevice } = await supabase
    .from<definitions['devices_override']>('devices_override')
    .select()
    .eq('app_id', appid)
    .eq('version', versionData.id);
  if ((deviceFound && deviceFound.length) || errorDevice) {
    program.error(`Version ${appid} @${bundle} is used in a device override, unlink it first ${formatError(errorDevice)}`);
  }
}