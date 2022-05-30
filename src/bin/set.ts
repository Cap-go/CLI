import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import { getConfig, createSupabaseClient, updateOrCreateChannel, host } from './utils';
import { definitions } from './types_supabase';

interface Options {
  apikey: string;
  version: string;
  state: string;
  channel?: string;
}

export const setChannel = async (appid: string, options: Options) => {
  let { version } = options;
  const { apikey, state, channel = 'dev' } = options;
  const config = await getConfig();
  appid = appid || config?.app?.appId
  version = version || config?.app?.package?.version
  let parsedState
  if (state === 'public' || state === 'private')
    parsedState = state === 'public'
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to add your app");
  }
  if (!appid) {
    program.error("Missing argument, you need to provide a appid, or be in a capacitor project");
  }
  if (!version && !parsedState) {
    program.error("Missing argument, you need to provide a state or a version");
  }
  if (version) {
    console.log(`Set ${channel} to @${version} in ${appid}`);
  } else {
    console.log(`Set${channel} to @${state} in ${appid}`);
  }
  try {
    const supabase = createSupabaseClient(apikey)
    const { data: dataUser, error: userIdError } = await supabase
      .rpc<string>('get_user_id', { apikey })

    const userId = dataUser ? dataUser.toString() : '';

    if (!userId || userIdError) {
      console.error('Cannot verify user');
      return
    }
    const channelPayload: Partial<definitions['channels']> = {
      created_by: userId,
      app_id: appid,
      name: channel,
    }
    if (version) {
      const { data, error: vError } = await supabase
        .from<definitions['app_versions']>('app_versions')
        .select()
        .eq('app_id', appid)
        .eq('name', version)
        .eq('user_id', userId)
        .eq('deleted', false)
      if (vError || !data || !data.length)
        program.error(`Cannot find version ${version}`);
      channelPayload.version = data[0].id
    }
    if (parsedState !== undefined)
      channelPayload.public = parsedState
    try {
      const { error: dbError } = await updateOrCreateChannel(supabase, channelPayload)
      if (dbError)
        program.error(`Cannot set channel \n${prettyjson.render(dbError)}`);
    }
    catch (e) {
      program.error(`Cannot set channel \n${prettyjson.render(e)}`);
    }
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      program.error(`Network Error \n${prettyjson.render(err.response?.data)}`);
    } else {
      program.error(`Unknow error \n${prettyjson.render(err)}`);
    }
  }
  if (version) {
    console.log(`Done ✅`);
  } else {
    console.log(`You can use now is channel in your app with the url: ${host}/api/latest?appid=${appid}&channel=${channel}`);
  }
}
