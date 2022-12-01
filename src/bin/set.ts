import { program } from 'commander';
import {
  getConfig, createSupabaseClient, updateOrCreateChannel,
  formatError, findSavedKey, checkPlanValid, useLogSnag, verifyUser
} from './utils';
import { definitions } from '../types/types_supabase';

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

export const setChannel = async (appid: string, options: Options) => {
  const { bundle, latest, downgrade, upgrade, ios, android, selfAssign, channel, state } = options;
  const apikey = options.apikey || findSavedKey()
  const config = await getConfig()
  const snag = useLogSnag()

  appid = appid || config?.app?.appId
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to add your app");
  }
  if (!appid) {
    program.error("Missing argument, you need to provide a appid, or be in a capacitor project");
  }
  if (latest && bundle) {
    program.error("Cannot set latest and bundle at the same time");
  }
  if (bundle === undefined &&
    state === undefined &&
    latest === undefined &&
    downgrade === undefined &&
    upgrade === undefined &&
    ios === undefined &&
    android === undefined &&
    selfAssign === undefined) {
    program.error("Missing argument, you need to provide a option to set");
  }
  try {
    const supabase = createSupabaseClient(apikey)
    const userId = await verifyUser(supabase, apikey, ['write', 'all']);
    await checkPlanValid(supabase, userId)
    const channelPayload: Partial<definitions['channels']> = {
      created_by: userId,
      app_id: appid,
      name: channel,
    }
    const bundleVersion = latest ? config?.app?.package?.version : bundle
    if (bundleVersion) {
      const { data, error: vError } = await supabase
        .from<definitions['app_versions']>('app_versions')
        .select()
        .eq('app_id', appid)
        .eq('name', bundleVersion)
        .eq('user_id', userId)
        .eq('deleted', false)
      if (vError || !data || !data.length)
        program.error(`Cannot find version ${bundleVersion}`);
      console.log(`Set ${appid} channel: ${channel} to @${bundle}`);
      channelPayload.version = data[0].id
    }
    if (state !== undefined) {
      if (state === 'public' || state === 'private') {
        console.log(`Set ${appid} channel: ${channel} to public or private is deprecated, use default or normal instead`);
      }
      console.log(`Set ${appid} channel: ${channel} to ${state === 'public' || state === 'default' ? 'default' : 'normal'}`);
      channelPayload.public = state === 'public' || state === 'default'
    }
    if (downgrade !== undefined) {
      console.log(`Set ${appid} channel: ${channel} to ${downgrade ? 'allow' : 'disallow'} downgrade`);
      channelPayload.disableAutoUpdateUnderNative = !downgrade
    }
    if (upgrade !== undefined) {
      console.log(`Set ${appid} channel: ${channel} to ${upgrade ? 'allow' : 'disallow'} upgrade`);
      channelPayload.disableAutoUpdateToMajor = !upgrade
    }
    if (ios !== undefined) {
      console.log(`Set ${appid} channel: ${channel} to ${ios ? 'allow' : 'disallow'} ios update`);
      channelPayload.ios = !!ios
    }
    if (android !== undefined) {
      console.log(`Set ${appid} channel: ${channel} to ${android ? 'allow' : 'disallow'} android update`);
      channelPayload.android = !!android
    }
    if (selfAssign !== undefined) {
      console.log(`Set ${appid} channel: ${channel} to ${selfAssign ? 'allow' : 'disallow'} self assign to this channel`);
      channelPayload.allow_device_self_set = !!selfAssign
    }
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
  console.log(`Done ✅`);
}
