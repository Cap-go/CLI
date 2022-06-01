import { program } from 'commander';
import { getConfig, createSupabaseClient, updateOrCreateChannel, host, formatError, findSavedKey, hostWeb } from './utils';
import { definitions } from './types_supabase';

interface Options {
  apikey: string;
  version: string;
  state: string;
  channel?: string;
}

export const setChannel = async (appid: string, options: Options) => {
  let { version } = options;
  const { state, channel = 'dev' } = options;
  const apikey = options.apikey || findSavedKey()
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
    const { data: apiAccess, error: apiAccessError } = await supabase
      .rpc('is_allowed_capgkey', { apikey, keymode: ['write', 'all'], app_id: appid })

    if (!apiAccess || apiAccessError) {
      program.error("Invalid API key or insufisant rights");
    }
    const { data: dataUser, error: userIdError } = await supabase
      .rpc<string>('get_user_id', { apikey })

    const userId = dataUser ? dataUser.toString() : '';

    if (!userId || userIdError) {
      program.error(`Cannot verify user ${formatError(userIdError)}`)
    }
    const { data: isTrial, error: isTrialsError } = await supabase
      .rpc<number>('is_trial', { userid: userId })
      .single()
    if (isTrial && isTrial > 0 || isTrialsError) {
      console.log(`WARNING !!\nTrial expires in ${isTrial} days, upgrade here: ${hostWeb}/app/usage\n`);
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
      const { error: dbError } = await updateOrCreateChannel(supabase, channelPayload, apikey)
      if (dbError)
        program.error(`Cannot set channel ${formatError(dbError)}`);
    }
    catch (e) {
      program.error(`Cannot set channel ${formatError(e)}`);
    }
  } catch (err) {
    program.error(`Unknow error ${formatError(err)}`);
  }
  if (version) {
    console.log(`Done ✅`);
  } else {
    console.log(`You can use now is channel in your app with the url: ${host}/api/latest?appid=${appid}&channel=${channel}`);
  }
}
