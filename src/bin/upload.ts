import AdmZip from 'adm-zip';
import { program } from 'commander';
import { randomUUID } from 'crypto';
import prettyjson from 'prettyjson';
import { host, hostWeb, getConfig, createSupabaseClient, updateOrCreateChannel, updateOrCreateVersion } from './utils';
import { definitions } from './types_supabase'

interface Options {
  version: string
  path: string
  apikey: string
  channel?: string
  external?: string
}
export const uploadVersion = async (appid: string, options: Options) => {
  let { version, path, channel } = options;
  const { apikey, external } = options;
  channel = channel || 'dev';
  const config = await getConfig();
  appid = appid || config?.app?.appId
  version = version || config?.app?.package?.version
  path = path || config?.app?.webDir
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to add your app");
  }
  if (!appid || !version || !path) {
    program.error("Missing argument, you need to provide a appid and a version and a path, or be in a capacitor project");
  }

  const supabase = createSupabaseClient(apikey)

  // checking if user has access rights before uploading
  const { data: apiAccess, error: apiAccessError } = await supabase
    .rpc('is_allowed_capgkey', { apikey, keymode: ['upload', 'write', 'all'] })

  if (!apiAccess || apiAccessError) {
    program.error("Invalid API key");
  }

  const { data, error: userIdError } = await supabase
    .rpc<string>('get_user_id', { apikey })

  const userId = data ? data.toString() : '';

  if (!userId || userIdError) {
    program.error("Cannot verify user");
  }

  const { data: app, error: dbError0 } = await supabase
    .from<definitions['apps']>('apps')
    .select()
    .eq('app_id', appid)
    .eq('user_id', userId)
  if (!app?.length || dbError0) {
    program.error(`Cannot find app ${appid} in your account`)
  }

  console.log(`Upload ${appid}@${version} started from path "${path}" to Capgo cloud`);

  if (!external) {
    const zip = new AdmZip();
    zip.addLocalFolder(path);
    const zipped = zip.toBuffer();
    const filePath = `apps/${userId}/${appid}/versions`
    const fileName = randomUUID()

    const { error: upError } = await supabase.storage
      .from(filePath)
      .upload(fileName, zipped, {
        contentType: 'application/zip',
      })
    if (upError) {
      program.error(`Cannot upload ${upError}`)
    }
  } else if (external && !external.startsWith('https://')) {
    program.error(`External link should should start with "https://" current is "${external}"`)
  } else {
    const fileName = randomUUID()
    const { data: versionData, error: dbError } = await updateOrCreateVersion(supabase, {
      bucket_id: external ? undefined : fileName,
      user_id: userId,
      name: version,
      app_id: appid,
      external_url: external,
    })
    const { error: dbError2 } = await supabase
      .from<definitions['apps']>('apps')
      .update({
        last_version: version,
      }).eq('app_id', appid)
      .eq('user_id', userId)
    if (dbError || dbError2 || !version || !version.length) {
      program.error(`Cannot add version \n${prettyjson.render(dbError || dbError2 || 'unknow error')}`)
    }
    const { error: dbError3 } = await updateOrCreateChannel(supabase, {
      name: channel,
      app_id: appid,
      created_by: userId,
      version: versionData[0].id,
    })
    if (dbError3) {
      program.error(`Cannot update or add channel \n${prettyjson.render(dbError3)}`)
    }
  }
  console.log("App uploaded to server")
  console.log(`Try it in mobile app: ${host}/app_mobile`)
  console.log(`Or set the channel ${channel} as public here: ${hostWeb}/app/package/${appid}`)
  console.log("To use with live update in your own app")
}