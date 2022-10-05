import { program } from 'commander';
import { getConfig, createSupabaseClient, formatError, findSavedKey, useLogSnag, verifyUser } from './utils';
import { definitions } from './types_supabase'

interface Options {
  apikey: string;
  bundle: string;
}

export const deleteApp = async (appid: string, options: Options) => {
  const { bundle } = options;
  const apikey = options.apikey || findSavedKey()
  const config = await getConfig();
  const snag = useLogSnag()

  appid = appid || config?.app?.appId
  if (!apikey) {
    program.error('Missing API key, you need to provide an API key to delete your app');
  }
  if (!appid) {
    program.error('Missing argument, you need to provide a appid, or be in a capacitor project');
  }

  const supabase = createSupabaseClient(apikey)

  const userId = await verifyUser(supabase, apikey);

  const { data: app, error: dbError0 } = await supabase
    .rpc<string>('exist_app', { appid, apikey })
  if (!app || dbError0) {
    program.error('No permission to delete')
  }

  if (bundle) {
    console.log(`Delete ${appid}@${bundle} from Capgo`);

    const { data: versionData, error: versionIdError } = await supabase
      .from<definitions['app_versions']>('app_versions')
      .select()
      .eq('app_id', appid)
      .eq('user_id', userId)
      .eq('name', bundle)
      .eq('deleted', false)
      .single()
    if (!versionData || versionIdError) {
      program.error(`Version ${appid}@${bundle} doesn't exist ${formatError(versionIdError)}`)
    }
    const { data: channelFound, error: errorChannel } = await supabase
      .from<definitions['channels']>('channels')
      .select()
      .eq('app_id', appid)
      .eq('created_by', userId)
      .eq('version', versionData.id)
    if ((channelFound && channelFound.length) || errorChannel) {
      program.error(`Version ${appid}@${bundle} is used in a channel, unlink it first ${formatError(errorChannel)}`)
    }
    const { data: deviceFound, error: errorDevice } = await supabase
      .from<definitions['devices_override']>('devices_override')
      .select()
      .eq('app_id', appid)
      .eq('version', versionData.id)
    if ((deviceFound && deviceFound.length) || errorDevice) {
      program.error(`Version ${appid} @${bundle} is used in a device override, unlink it first ${formatError(errorDevice)}`)
    }
    // Delete only a specific version in storage
    const { error: delError } = await supabase
      .storage
      .from('apps')
      .remove([`${userId}/${appid}/versions/${versionData.bucket_id} `])
    if (delError) {
      program.error(`Something went wrong when trying to delete ${appid} @${bundle} ${delError} `)
    }

    const { error: delAppSpecVersionError } = await supabase
      .from<definitions['app_versions']>('app_versions')
      .update({
        deleted: true,
      })
      .eq('app_id', appid)
      .eq('user_id', userId)
      .eq('name', bundle)
    if (delAppSpecVersionError) {
      program.error(`App ${appid}@${bundle} not found in database '${delAppSpecVersionError}'`)
    }
    console.log(`${appid}@${bundle} deleted from server`)
    return
  }

  console.log(`Delete ${appid} from Capgo`);
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
  snag.publish({
    channel: 'app',
    event: 'App Deleted',
    icon: '😱',
    tags: {
      'user-id': userId,
      'app-id': appid,
    },
    notify: false,
  }).catch()
  console.log(`${appid} deleted from server`)
}
