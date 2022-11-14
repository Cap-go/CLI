import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';

export async function deleteFromStorage(supabase: SupabaseClient, userId: string, appid: string, versionData: { id: number; created_at?: string; app_id: string; name: string; bucket_id?: string; user_id: string; updated_at?: string; deleted: boolean; external_url?: string; checksum?: string }, bundle: string) {
  const { error: delError } = await supabase
    .storage
    .from('apps')
    .remove([`${userId}/${appid}/versions/${versionData.bucket_id} `]);
  if (delError) {
    program.error(`Something went wrong when trying to delete ${appid} @${bundle} ${delError} `);
  }
}