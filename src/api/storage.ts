import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { Database } from 'types/supabase.types';
import { formatError } from '../bin/utils';

export const deleteFromStorage = async (supabase: SupabaseClient<Database>,
  userId: string, appid: string, versionData: Database['public']['Tables']['app_versions']['Row'], bundle: string) => {
  const { error: delError } = await supabase
    .storage
    .from('apps')
    .remove([`${userId}/${appid}/versions/${versionData.bucket_id} `]);
  if (delError) {
    program.error(`Something went wrong when trying to delete ${appid} @${bundle} ${formatError(delError)} `);
  }
}