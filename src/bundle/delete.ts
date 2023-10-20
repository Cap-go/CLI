import { program } from 'commander';
import * as p from '@clack/prompts';
import { checkAppExistsAndHasPermissionErr } from '../api/app';
import { OptionsBase } from '../api/utils';
import { createSupabaseClient, findSavedKey, getConfig, verifyUser } from '../utils';
import { deleteSpecificVersion } from '../api/versions';

interface Options extends OptionsBase {
  bundle: string;
}

export const deleteBundle = async (bundleId: string, appId: string, options: Options) => {
  p.intro(`Delete bundle`);
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig();
  appId = appId || config?.app?.appId

  if (!options.apikey) {
    p.log.error("Missing API key, you need to provide a API key to upload your bundle");
    program.error('');
  }
  if (!appId) {
    p.log.error("Missing argument, you need to provide a appId, or be in a capacitor project");
    program.error('');
  }
  const supabase = await createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all']);
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionErr(supabase, appId);

  const apikey = options.apikey || findSavedKey()

  appId = appId || config?.app?.appId
  if (!apikey) {
    p.log.error('Missing API key, you need to provide an API key to delete your app');
    program.error('');
  }
  if (!bundleId) {
    p.log.error('Missing argument, you need to provide a bundleId, or be in a capacitor project');
    program.error('');
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project');
    program.error('');
  }

  p.log.info(`Deleting bundle ${appId}@${bundleId} from Capgo`);

  await deleteSpecificVersion(supabase, appId, userId, bundleId);
  p.log.success(`Bundle ${appId}@${bundleId} deleted in Capgo`);
  p.outro(`Done`);
  process.exit()
}
