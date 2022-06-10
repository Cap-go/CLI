import { program } from 'commander';
import { getConfig, createSupabaseClient, formatError, findSavedKey, checkKey } from './utils';
import { definitions } from './types_supabase'

interface Options {
  apikey: string;
  version: string;
}

export const deleteApp = async (appid: string, options: Options) => {
  const { version } = options;
  const apikey = options.apikey || findSavedKey()
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

  await checkKey(supabase, apikey, ['all']);

  const { data: dataUser, error: userIdError } = await supabase
    .rpc<string>('get_user_id', { apikey })

  const userId = dataUser ? dataUser.toString() : '';

  if (!userId || userIdError) {
    program.error(`Cannot verify user ${formatError(userIdError)}`);
  }

  const { data: app, error: dbError0 } = await supabase
    .rpc<string>('exist_app', { appid, apikey })
  if (!app || dbError0) {
    program.error('No permission to delete')
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
      program.error(`Version ${appid}@${version} don't exist ${formatError(versionIdError)}`)
    }
    const { data: channelFound, error: errorChannel } = await supabase
      .from<definitions['channels']>('channels')
      .select()
      .eq('app_id', appid)
      .eq('created_by', userId)
      .eq('version', versions[0].id)
    if ((channelFound && channelFound.length) || errorChannel) {
      program.error(`Version ${appid}@${version} is used in a channel, unlink it first ${formatError(errorChannel)}`)
    }
    const { data: deviceFound, error: errorDevice } = await supabase
      .from<definitions['devices_override']>('devices_override')
      .select()
      .eq('app_id', appid)
      .eq('version', versions[0].id)
    if ((deviceFound && deviceFound.length) || errorDevice) {
      program.error(`Version ${appid} @${version} is used in a device override, unlink it first ${formatError(errorDevice)}`)
    }
    // Delete only a specific version in storage
    const { error: delError } = await supabase
      .storage
      .from('apps')
      .remove([`${userId} /${appid}/versions / ${versions[0].bucket_id} `])
    if (delError) {
      program.error(`Something went wrong when trying to delete ${appid} @${version} ${delError} `)
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
      program.error(`App ${appid} @${version} not found in database ${delAppSpecVersionError} `)
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
    program.error(`App ${appid} not found in database ${vError} `)
  }

  if (data && data.length) {
    const filesToRemove = data.map(x => `${userId}/${appid}/versions/${x.bucket_id} `)
    const { error: delError } = await supabase
      .storage
      .from('apps')
      .remove(filesToRemove)
    if (delError) {
      program.error(`Cannot delete stored version for app ${appid} from storage ${delError} `)
    }
  }

  const { error: delAppVersionError } = await supabase
    .from<definitions['app_versions']>('app_versions')
    .delete()
    .eq('app_id', appid)
    .eq('user_id', userId)

  if (delAppVersionError) {
    program.error(`Cannot delete version for app ${appid} from database ${delAppVersionError} `)
  }

  const { error: dbAppError } = await supabase
    .from<definitions['apps']>('apps')
    .delete()
    .eq('app_id', appid)
    .eq('user_id', userId)

  if (dbAppError) {
    program.error(`Cannot delete from database ${dbAppError} `)
  }

  console.log("App deleted from server")
}
