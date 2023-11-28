import { SupabaseClient } from '@supabase/supabase-js';
import * as p from '@clack/prompts';
import { program } from 'commander';
import { Database } from 'types/supabase.types';
import { isAllowedApp, OptionsBase } from '../utils';

export const checkAppExists = async (supabase: SupabaseClient<Database>, appid: string) => {
  const { data: app } = await supabase
    .rpc('exist_app_v2', { appid })
    .single();
  return !!app;
}

export const checkAppExistsAndHasPermissionErr = async (supabase: SupabaseClient<Database>, apikey: string, appid: string,
  shouldExist = true) => {
  const res = await checkAppExists(supabase, appid);
  const perm = await isAllowedApp(supabase, apikey, appid);

  if (res && !shouldExist) {
    p.log.error(`App ${appid} already exist`);
    program.error('');
  }
  if (!res && shouldExist) {
    p.log.error(`App ${appid} does not exist`);
    program.error('');
  }
  if (res && !perm) {
    p.log.error(`App ${appid} exist and you don't have permission to access it`);
    program.error('');
  }
}

export interface Options extends OptionsBase {
  name?: string;
  icon?: string;
  retention?: number;
}

export const newIconPath = "assets/icon.png"
