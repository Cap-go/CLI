import { program } from 'commander';
import * as p from '@clack/prompts';
import { checkAppExistsAndHasPermissionErr } from '../api/app';
import { getActiveChannels, displayChannels } from '../api/channels';
import { OptionsBase } from '../api/utils';
import { findSavedKey, getConfig, createSupabaseClient, verifyUser, useLogSnag } from '../utils';

export const listChannels = async (appId: string, options: OptionsBase) => {
  p.intro(`List channels`);
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig();
  appId = appId || config?.app?.appId
  const snag = useLogSnag()

  if (!options.apikey) {
    p.log.error("Missing API key, you need to provide a API key to upload your bundle");
  }
  if (!appId) {
    p.log.error("Missing argument, you need to provide a appId, or be in a capacitor project");
    program.error('');
  }
  const supabase = await createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all', 'read', 'upload']);
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionErr(supabase, appId);

  p.log.info(`Querying available channels in Capgo`);

  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionErr(supabase, appId);

  // Get all active app versions we might possibly be able to cleanup
  const allVersions = await getActiveChannels(supabase, appId, userId);

  p.log.info(`Active channels in Capgo: ${allVersions?.length}`);

  displayChannels(allVersions);
  await snag.track({
    channel: 'channel',
    event: 'List channel',
    icon: '✅',
    user_id: userId,
    tags: {
      'app-id': appId,
    },
    notify: false,
  }).catch()
  p.outro(`Done ✅`);
  process.exit()
}
