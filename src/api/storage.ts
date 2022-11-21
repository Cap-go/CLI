import { SupabaseClient } from '@supabase/supabase-js';
import { formatError } from 'bin/utils';
import { program } from 'commander';

interface VersionData {
  id: number;
  created_at?: string;
  app_id: string;
  name: string;
  bucket_id?: string;
  user_id: string;
  updated_at?: string;
  deleted: boolean;
  external_url?: string;
  checksum?: string
}

export const deleteFromStorage = async (supabase: SupabaseClient,
  userId: string, appid: string, versionData: VersionData, bundle: string) => {
  const { error: delError } = await supabase
    .storage
    .from('apps')
    .remove([`${userId}/${appid}/versions/${versionData.bucket_id} `]);
  if (delError) {
    program.error(`Something went wrong when trying to delete ${appid} @${bundle} ${formatError(delError)} `);
  }
}