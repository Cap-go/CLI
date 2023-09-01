import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { Database } from 'types/supabase.types';
import { OptionsBase } from './utils';

export const checkAppExistsAndHasPermission = async (supabase: SupabaseClient<Database>, appid: string,
  shouldExist = true) => {
  const { data: app, error: dbError0 } = await supabase
    .rpc('exist_app_v2', { appid })
    .single();
  return app !== shouldExist || dbError0;
}

export const checkAppExistsAndHasPermissionErr = async (supabase: SupabaseClient<Database>, appid: string,
  shouldExist = true) => {
  const res = await checkAppExistsAndHasPermission(supabase, appid, shouldExist);
  if (res) {
    program.error(`App ${appid} does not exist or you don't have permission to access it`);
  }
}

export interface Options extends OptionsBase {
  name?: string;
  icon?: string;
  retention?: number;
}

export const newIconPath = "assets/icon.png"
