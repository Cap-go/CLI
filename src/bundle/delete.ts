import { program } from 'commander';
import { checkAppExistsAndHasPermission } from '../api/app';
import { OptionsBase } from '../api/utils';
import { createSupabaseClient, findSavedKey, getConfig, verifyUser } from '../utils';
import { deleteSpecificVersion } from '../api/versions';

interface Options extends OptionsBase {
  bundle: string;
}

export const deleteBundle = async (appId: string, bundleId: string, options: Options) => {
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig();
  appId = appId || config?.app?.appId

  if (!options.apikey) {
    program.error("Missing API key, you need to provide a API key to upload your bundle");
  }
  if (!appId) {
    program.error("Missing argument, you need to provide a appId, or be in a capacitor project");
  }
  const supabase = createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all']);
  // Check we have app access to this appId
  await checkAppExistsAndHasPermission(supabase, appId, options.apikey);

  const apikey = options.apikey || findSavedKey()

  appId = appId || config?.app?.appId
  if (!apikey) {
    program.error('Missing API key, you need to provide an API key to delete your app');
  }
  if (!bundleId) {
    program.error('Missing argument, you need to provide a bundleId, or be in a capacitor project');
  }
  if (!appId) {
    program.error('Missing argument, you need to provide a appId, or be in a capacitor project');
  }

  console.log(`Delete ${appId}@${bundleId} from Capgo`);

  await deleteSpecificVersion(supabase, appId, userId, bundleId);
  console.log(`${appId}@${bundleId} deleted from server`)
  console.log(`Done ✅`);
  process.exit()
}
