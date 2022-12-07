import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { Table } from 'console-table-printer';
import { Database } from 'types/supabase.types';
// import { definitions } from '../types/types_supabase';
import { formatError, getHumanDate } from '../bin/utils';
import { checkVersionNotUsedInChannel } from './channels';
import { checkVersionNotUsedInDeviceOverride } from './devices_override';
import { deleteFromStorage } from './storage';

export const deleteAppVersion = async (supabase: SupabaseClient<Database>, appid: string, userId: string, bundle: string) => {
  const { error: delAppSpecVersionError } = await supabase
    .from('app_versions')
    .update({
      deleted: true
    })
    .eq('app_id', appid)
    .eq('user_id', userId)
    .eq('name', bundle);
  if (delAppSpecVersionError) {
    program.error(`App ${appid}@${bundle} not found in database '${formatError(delAppSpecVersionError)}'`);
  }
}

export const deleteSpecificVersion = async (supabase: SupabaseClient<Database>, appid: string, userId: string, bundle: string) => {
  const versionData = await getVersionData(supabase, appid, userId, bundle);
  await checkVersionNotUsedInChannel(supabase, appid, userId, versionData, bundle);
  await checkVersionNotUsedInDeviceOverride(supabase, appid, versionData, bundle);
  // Delete only a specific version in storage
  await deleteFromStorage(supabase, userId, appid, versionData, bundle);

  await deleteAppVersion(supabase, appid, userId, bundle);
}

export const displayBundles = (data: (Database['public']['Tables']['app_versions']['Row'] & { keep?: string })[]) => {
  const p = new Table({
    title: "Bundles",
    charLength: { "❌": 2, "✅": 2 },
  });

  // add rows with color
  data.reverse().forEach(row => {
    p.addRow({
      Version: row.name,
      Created: getHumanDate(row),
      ...(row.keep !== undefined ? { Keep: row.keep } : {})
    });
  });

  p.printTable();
}

export const getActiveAppVersions = async (supabase: SupabaseClient<Database>, appid: string, userId: string) => {
  const { data, error: vError } = await supabase
    .from('app_versions')
    .select()
    .eq('app_id', appid)
    .eq('user_id', userId)
    .eq('deleted', false)
    .order('id');

  if (vError) {
    program.error(`App ${appid} not found in database ${formatError(vError)} `);
  }
  return data;
}

export const getVersionData = async (supabase: SupabaseClient<Database>, appid: string, userId: string, bundle: string) => {
  const { data: versionData, error: versionIdError } = await supabase
    .from('app_versions')
    .select()
    .eq('app_id', appid)
    .eq('user_id', userId)
    .eq('name', bundle)
    .eq('deleted', false)
    .single();
  if (!versionData || versionIdError) {
    program.error(`Version ${appid}@${bundle} doesn't exist ${formatError(versionIdError)}`);
  }
  return versionData;
}