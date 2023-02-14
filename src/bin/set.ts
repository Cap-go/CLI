import { program } from 'commander';
import LogSnag from 'logsnag';
import { Database } from 'types/supabase.types';
import { checkAppExistsAndHasPermission } from "../api/app";
import {
  getConfig, createSupabaseClient, updateOrCreateChannel,
  formatError, findSavedKey, checkPlanValid, useLogSnag, verifyUser
} from './utils';
// import { definitions } from '../types/types_supabase';
import { checkLatest } from '../api/update';

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

export const setChannelInternal = async (appid: string, apikey: string, defaulVersion: string, snag: LogSnag, options: Options) => {
  const { bundle, latest, downgrade, upgrade, ios, android, selfAssign, channel, state } = options;
  if (!channel) {
    program.error("Missing argument, you need to provide a channel");
  }
  if (latest && bundle) {
    program.error("Cannot set latest and bundle at the same time");
  }
  if (bundle == null &&
    state == null &&
    latest == null &&
    downgrade == null &&
    upgrade == null &&
    ios == null &&
    android == null &&
    selfAssign == null) {
    program.error("Missing argument, you need to provide a option to set");
  }
  try {
    const supabase = createSupabaseClient(apikey)
    const userId = await verifyUser(supabase, apikey, ['write', 'all']);
    await checkPlanValid(supabase, userId)
    // Check we have app access to this appId
    await checkAppExistsAndHasPermission(supabase, appid, apikey);
    const channelPayload: Database['public']['Tables']['channels']['Insert'] = {
      created_by: userId,
      app_id: appid,
      name: channel,
      version: undefined as any,
    }
    const bundleVersion = latest ? defaulVersion : bundle
    if (bundleVersion != null) {
      const { data, error: vError } = await supabase
        .from('app_versions')
        .select()
        .eq('app_id', appid)
        .eq('name', bundleVersion)
        .eq('user_id', userId)
        .eq('deleted', false)
        .single()
      if (vError || !data)
        program.error(`Cannot find version ${bundleVersion}`);
      console.log(`Set ${appid} channel: ${channel} to @${bundleVersion}`);
      channelPayload.version = data.id
    }
    if (state != null) {
      if (state === 'public' || state === 'private') {
        console.log(`Set ${appid} channel: ${channel} to public or private is deprecated, use default or normal instead`);
      }
      console.log(`Set ${appid} channel: ${channel} to ${state === 'public' || state === 'default' ? 'default' : 'normal'}`);
      channelPayload.public = state === 'public' || state === 'default'
    }
    if (downgrade != null) {
      console.log(`Set ${appid} channel: ${channel} to ${downgrade ? 'allow' : 'disallow'} downgrade`);
      channelPayload.disableAutoUpdateUnderNative = !downgrade
    }
    if (upgrade != null) {
      console.log(`Set ${appid} channel: ${channel} to ${upgrade ? 'allow' : 'disallow'} upgrade`);
      channelPayload.disableAutoUpdateToMajor = !upgrade
    }
    if (ios != null) {
      console.log(`Set ${appid} channel: ${channel} to ${ios ? 'allow' : 'disallow'} ios update`);
      channelPayload.ios = !!ios
    }
    if (android != null) {
      console.log(`Set ${appid} channel: ${channel} to ${android ? 'allow' : 'disallow'} android update`);
      channelPayload.android = !!android
    }
    if (selfAssign != null) {
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
    await snag.publish({
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

export const setChannel = async (appid: string, options: Options) => {
  await checkLatest();
  const apikey = options.apikey || findSavedKey()
  const config = await getConfig()
  const snag = useLogSnag()

  console.log('COMMAND DEPRECATED, use "channel set" instead')
  appid = appid || config?.app?.appId
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to set your app");
  }
  if (!appid) {
    program.error("Missing argument, you need to provide a appid, or be in a capacitor project");
  }
  return setChannelInternal(appid, apikey, config?.app?.package?.version, snag, options)
  process.exit()
}
