import { SupabaseClient } from '@supabase/supabase-js';
import { program } from 'commander';
import { Database } from 'types/supabase.types';
import { OptionsBase } from './utils';

export const checkAppExistsAndHasPermission = async (supabase: SupabaseClient<Database>, appid: string, apikey: string) => {
  const { data: app, error: dbError0 } = await supabase
    .rpc('exist_app', { appid, apikey })
    .single();
  if (!app || dbError0) {
    program.error('No permission for this app');
  }
}

export interface Options extends OptionsBase {
  name?: string;
  icon?: string;
}

export const newIconPath = "assets/icon.png"