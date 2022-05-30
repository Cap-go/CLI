import { program } from 'commander';
import { getConfig, createSupabaseClient, checkAppOwner } from './utils';
import { definitions } from './types_supabase'

interface Options {
  apikey: string;
  version: string;
}

export const deleteApp = async (appid: string, options: Options) => {
  const { apikey, version } = options;
  const config = await getConfig();
  appid = appid || config?.app?.appId
  if (!apikey) {
    program.error('Missing API key, you need to provide an API key to delete your app');
  }
  if (!appid) {
    program.error('Missing argument, you need to provide a appid, or be in a capacitor project');
  }
  console.log(`Delete ${appid} to Capgo`);

  const supabase = createSupabaseClient(apikey)

  // checking if user has access rights before deleting
  const { data: apiAccess, error: apiAccessError } = await supabase
    .rpc('is_allowed_capgkey', { apikey, keymode: ['write', 'all'] })

  if (!apiAccess || apiAccessError) {
    console.log('Invalid API key');
    return
  }

  const { data: dataUser, error: userIdError } = await supabase
    .rpc<string>('get_user_id', { apikey })

  const userId = dataUser ? dataUser.toString() : '';

  if (!userId || userIdError) {
    console.error('Cannot verify user');
    return
  }

  // check if user is the owner of the app
  if (!(await checkAppOwner(supabase, userId, appid))) {
    console.error('No permission to delete')
    return;
  }

  if (version) {
    const { data: versions, error: versionIdError } = await supabase
      .from<definitions['app_versions']>('app_versions')
      .select()
      .eq('app_id', appid)
      .eq('user_id', userId)
      .eq('name', version)
      .eq('deleted', false)
    if (!versions || !versions.length || versionIdError) {
      console.error(`Version ${appid}@${version} don't exist`, versionIdError)
      return
    }
    const { data: channelFound, error: errorChannel } = await supabase
      .from<definitions['channels']>('channels')
      .select()
      .eq('app_id', appid)
      .eq('created_by', userId)
      .eq('version', versions[0].id)
    if ((channelFound && channelFound.length) || errorChannel) {
      console.error(`Version ${appid}@${version} is used in a channel, unlink it first`, errorChannel);
      return
    }
    const { data: deviceFound, error: errorDevice } = await supabase
      .from<definitions['devices_override']>('devices_override')
      .select()
      .eq('app_id', appid)
      .eq('version', versions[0].id)
    if ((deviceFound && deviceFound.length) || errorDevice) {
      console.error(`Version ${appid}@${version} is used in a device override, unlink it first`, errorChannel)
      return
    }
    // Delete only a specific version in storage
    const { error: delError } = await supabase
      .storage
      .from('apps')
      .remove([`${userId}/${appid}/versions/${versions[0].bucket_id}`])
    if (delError) {
      console.error(`Something went wrong when trying to delete ${appid}@${version}`, delError)
      return
    }

    const { error: delAppSpecVersionError } = await supabase
      .from<definitions['app_versions']>('app_versions')
      .update({
        deleted: true,
      })
      .eq('app_id', appid)
      .eq('name', version)
      .eq('user_id', userId)
    if (delAppSpecVersionError) {
      console.error(`App ${appid}@${version} not found in database`, delAppSpecVersionError)
      return
    }
    console.log("App version deleted from server")
    return
  }

  const { data, error: vError } = await supabase
    .from<definitions['app_versions']>('app_versions')
    .select()
    .eq('app_id', appid)
    .eq('user_id', userId)

  if (vError) {
    console.error(`App ${appid} not found in database`, vError)
    return
  }

  if (data && data.length) {
    const filesToRemove = data.map(x => `${userId}/${appid}/versions/${x.bucket_id}`)
    const { error: delError } = await supabase
      .storage
      .from('apps')
      .remove(filesToRemove)
    if (delError) {
      console.error(`Cannot delete stored version for app ${appid} from storage`, delError)
      return
    }
  }

  const { error: delAppVersionError } = await supabase
    .from<definitions['app_versions']>('app_versions')
    .delete()
    .eq('app_id', appid)
    .eq('user_id', userId)

  if (delAppVersionError) {
    console.error(`Cannot delete version for app ${appid} from database`, delAppVersionError)
    return
  }

  const { error: dbAppError } = await supabase
    .from<definitions['apps']>('apps')
    .delete()
    .eq('app_id', appid)
    .eq('user_id', userId)

  if (dbAppError) {
    console.error('Cannot delete from database', dbAppError)
    return
  }

  console.log("App deleted from server")
}
