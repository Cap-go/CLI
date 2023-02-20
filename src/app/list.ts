import { program } from 'commander';
import { checkAppExistsAndHasPermission } from '../api/app';
import { OptionsBase } from '../api/utils';
import { getActiveAppVersions, displayBundles } from '../api/versions';
import { createSupabaseClient, findSavedKey, getConfig, verifyUser } from '../utils';
import { checkLatest } from '../api/update';

export const listApp = async (appId: string, options: OptionsBase) => {
  await checkLatest();
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig();

  appId = appId || config?.app?.appId
  if (!options.apikey) {
    program.error('Missing API key, you need to provide an API key to delete your app');
  }
  if (!appId) {
    program.error('Missing argument, you need to provide a appid, or be in a capacitor project');
  }

  const supabase = createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey);

  console.log(`Querying available versions in Capgo`);

  // Check we have app access to this appId
  await checkAppExistsAndHasPermission(supabase, appId, options.apikey);

  // Get all active app versions we might possibly be able to cleanup
  const allVersions = await getActiveAppVersions(supabase, appId, userId);

  console.log(`Active versions in Capgo: ${allVersions?.length}`);

  displayBundles(allVersions);
  console.log(`Done ✅`);
  process.exit()
}
