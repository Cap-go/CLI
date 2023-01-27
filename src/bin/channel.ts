import { SupabaseClient } from '@supabase/supabase-js'
import { program } from 'commander'
import { Database } from 'types/supabase.types'
import { setChannelInternal } from './set';
import { checkAppExistsAndHasPermission } from "../api/app";
import {
  getConfig, createSupabaseClient,
  findSavedKey, checkPlanValid,
  verifyUser,
  useLogSnag,
} from './utils';

interface Options {
  apikey: string;
  bundle: string;
  state?: string;
  downgrade?: boolean;
  latest?: boolean;
  upgrade?: boolean;
  ios?: boolean;
  android?: boolean;
  selfAssign?: boolean;
  channel?: string;
}

const findUnknownVersion = (supabase: SupabaseClient<Database>, appId: string) => supabase
  .from('app_versions')
  .select('id')
  .eq('app_id', appId)
  .eq('name', 'unknown')
  .single()


const createChannel = (supabase: SupabaseClient<Database>, update: Database['public']['Tables']['channels']['Insert']) => supabase
  .from('channels')
  .insert(update)
  .select()
  .single()

const deleteChannel = (supabase: SupabaseClient<Database>, name: string, appId: string, userId: string) => supabase
  .from('channels')
  .delete()
  .eq('name', name)
  .eq('app_id', appId)
  .eq('user_id', userId)
  .single()

export const manageChannel = async (mode: string, channelId: string, appid: string, options: Options) => {
  const apikey = options.apikey || findSavedKey()
  const config = await getConfig();
  appid = appid || config?.app?.appId
  const snag = useLogSnag()

  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to upload your bundle");
  }
  if (!appid || !channelId) {
    program.error("Missing argument, you need to provide a appid and a channel name, or be in a capacitor project");
  }
  const supabase = createSupabaseClient(apikey)

  const userId = await verifyUser(supabase, apikey, ['write', 'all']);
  await checkPlanValid(supabase, userId, false)
  // Check we have app access to this appId
  await checkAppExistsAndHasPermission(supabase, appid, apikey);

  if (mode === 'create') {
    console.log(`Create channel ${appid}#${channelId} to Capgo cloud`);
    try {
      const { data } = await findUnknownVersion(supabase, appid)
      if (!data) {
        program.error(`Cannot find default version for channel creation, please contact Capgo support 🤨`);
      }
      await createChannel(supabase, { name: channelId, app_id: appid, version: data.id, created_by: userId });
      console.log(`Channel created ✅`);
      snag.publish({
        channel: 'app',
        event: 'Create channel',
        icon: '✅',
        tags: {
          'user-id': userId,
          'app-id': appid,
          'channel': channelId,
        },
        notify: false,
      }).catch()
    } catch (error) {
      console.log(`Cannot create Channel 🙀`, error);
    }
  } else if (mode === 'delete') {
    console.log(`Delete channel ${appid}#${channelId} to Capgo cloud`);
    try {
      await deleteChannel(supabase, channelId, appid, userId);
      console.log(`Channel Delete ✅`);
      snag.publish({
        channel: 'app',
        event: 'Delete channel',
        icon: '✅',
        tags: {
          'user-id': userId,
          'app-id': appid,
          'channel': channelId,
        },
        notify: false,
      }).catch()
    } catch (error) {
      console.log(`Cannot delete Channel 🙀`, error);
    }
  } else if (mode === 'set') {
    console.log(`Set channel ${appid}#${channelId} to Capgo cloud`);
    try {
      options.channel = channelId
      await setChannelInternal(appid, apikey, config?.app?.package?.version, snag, options);
      console.log(`Channel Set ✅`);
    } catch (error) {
      console.log(`Cannot set Channel 🙀`, error);
    }
  } else {
    program.error('You should provide a valid option (create or delete)');
  }
}