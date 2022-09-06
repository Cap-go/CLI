import { program } from 'commander';
import { getConfig, createSupabaseClient, findSavedKey, verifyUser } from './utils';
import { definitions } from './types_supabase'

interface Options {
  apikey: string;
  version: string;
}

export const listApp = async (appid: string, options: Options) => {
  const apikey = options.apikey || findSavedKey()
  const config = await getConfig();

  appid = appid || config?.app?.appId
  if (!apikey) {
    program.error('Missing API key, you need to provide an API key to delete your app');
  }
  if (!appid) {
    program.error('Missing argument, you need to provide a appid, or be in a capacitor project');
  }
  console.log(`Querying available versions in Capgo`);

  const supabase = createSupabaseClient(apikey)

  const userId = await verifyUser(supabase, apikey);

  const { data: app, error: dbError0 } = await supabase
    .rpc<string>('exist_app', { appid, apikey })
  if (!app || dbError0) {
    program.error('No permission for this app')
  }

  const { data, error: vError } = await supabase
    .from<definitions['app_versions']>('app_versions')
    .select()
    .eq('app_id', appid)
    .eq('user_id', userId)
    .eq('deleted', false)

  console.log(`Active versions in Capgo: ${  data?.length}`);

  data?.forEach(row => {
    console.log(`Version : ${row.name}  created on ${row.created_at}`);
  });

  if (vError) {
    program.error(`App ${appid} not found in database ${vError} `)
  }


}
