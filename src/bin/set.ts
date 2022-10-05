import { program } from 'commander';
import {
  getConfig, createSupabaseClient, updateOrCreateChannel,
  host, formatError, findSavedKey, checkPlan, useLogSnag, verifyUser
} from './utils';
import { definitions } from './types_supabase';

interface Options {
  apikey: string;
  bundle: string;
  state: string;
  channel?: string;
}

export const setChannel = async (appid: string, options: Options) => {
  let { bundle } = options;
  const { state, channel = 'dev' } = options;
  const apikey = options.apikey || findSavedKey()
  const config = await getConfig();
  const snag = useLogSnag()

  appid = appid || config?.app?.appId
  bundle = bundle || config?.app?.package?.version
  let parsedState
  if (state === 'public' || state === 'private')
    parsedState = state === 'public'
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to add your app");
  }
  if (!appid) {
    program.error("Missing argument, you need to provide a appid, or be in a capacitor project");
  }
  if (!bundle && !parsedState) {
    program.error("Missing argument, you need to provide a state or a version");
  }
  if (bundle) {
    console.log(`Set ${channel} to @${bundle} in ${appid}`);
  } else {
    console.log(`Set${channel} to @${state} in ${appid}`);
  }
  try {
    const supabase = createSupabaseClient(apikey)
    const userId = await verifyUser(supabase, apikey, ['write', 'all']);
    await checkPlan(supabase, userId)
    const channelPayload: Partial<definitions['channels']> = {
      created_by: userId,
      app_id: appid,
      name: channel,
    }
    if (bundle) {
      const { data, error: vError } = await supabase
        .from<definitions['app_versions']>('app_versions')
        .select()
        .eq('app_id', appid)
        .eq('name', bundle)
        .eq('user_id', userId)
        .eq('deleted', false)
      if (vError || !data || !data.length)
        program.error(`Cannot find version ${bundle}`);
      channelPayload.version = data[0].id
    }
    if (parsedState !== undefined)
      channelPayload.public = parsedState
    try {
      const { error: dbError } = await updateOrCreateChannel(supabase, channelPayload, apikey)
      if (dbError)
        program.error(`Cannot set channel ${formatError(dbError)}`);
    }
    catch (e) {
      program.error(`Cannot set channel ${formatError(e)}`);
    }
    snag.publish({
      channel: 'app',
      event: 'Set app',
      icon: '✅',
      tags: {
        'user-id': userId,
        'app-id': appid,
      },
      notify: false,
    }).catch()
  } catch (err) {
    program.error(`Unknow error ${formatError(err)}`);
  }
  if (bundle) {
    console.log(`Done ✅`);
  } else {
    console.log(`You can use now is channel in your app with the url: ${host}/api/latest?appid=${appid}&channel=${channel}`);
  }
}
