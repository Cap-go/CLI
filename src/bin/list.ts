import { program } from 'commander';
import { createSupabaseClient, findSavedKey, getConfig, verifyUser } from './utils';
import { checkAppExistsAndHasPermission } from '../api/app';
import { displayBundles, getActiveAppVersions } from '../api/versions';

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

  // Check we have app access to this appId
  await checkAppExistsAndHasPermission(supabase, appid, apikey);

  // Get all active app versions we might possibly be able to cleanup
  const allVersions = await getActiveAppVersions(supabase, appid, userId);

  console.log(`Active versions in Capgo: ${allVersions?.length}`);

  displayBundles(allVersions);
  process.exit()
}
