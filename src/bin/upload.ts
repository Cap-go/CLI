import AdmZip from 'adm-zip';
import { program } from 'commander';
import { randomUUID } from 'crypto';
import prettyjson from 'prettyjson';
import cliProgress from 'cli-progress';
import { host, hostWeb, getConfig, createSupabaseClient, updateOrCreateChannel, updateOrCreateVersion } from './utils';
import { definitions } from './types_supabase'

interface Options {
  version: string
  path: string
  apikey: string
  channel?: string
  external?: string
}

const maxMb = 30;
const alertMb = 25;

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
    program.error("Invalid API key or insufisant rights");
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
    const b1 = new cliProgress.SingleBar({
      format: 'Uploading: [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} Mb'
    }, cliProgress.Presets.shades_grey);
    const zip = new AdmZip();
    zip.addLocalFolder(path);
    const zipped = zip.toBuffer();
    const mbSize = Math.floor(zipped.byteLength / 1024 / 1024);
    const filePath = `apps/${userId}/${appid}/versions`
    const fileName = randomUUID()
    // program.error(`mbSize ${mbSize} Mb`);
    if (mbSize > maxMb) {
      program.error(`The app is too big, the limit is ${maxMb} Mb, your is ${mbSize} Mb`);
    }
    if (mbSize > alertMb) {
      console.log(`WARNING !!\nThe app size is ${mbSize} Mb, the limit is ${maxMb} Mb`);
    }

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
  }
  const fileName = randomUUID()
  const { data: versionData, error: dbError } = await updateOrCreateVersion(supabase, {
    bucket_id: external ? undefined : fileName,
    user_id: userId,
    name: version,
    app_id: appid,
    external_url: external,
  }, apikey)
  if (dbError) {
    program.error(`Cannot add version \n${prettyjson.render(dbError || 'unknow error')}`)
  }
  if (versionData && versionData.length) {
    const { error: dbError3 } = await updateOrCreateChannel(supabase, {
      name: channel,
      app_id: appid,
      created_by: userId,
      version: versionData[0].id,
    }, apikey)
    if (dbError3) {
      console.log('\n=> Cannot set version with upload key, use key with more rights for that\n')
    }
  } else {
    console.log('Cannot set version with upload key, use key with more rights for that')

  }

  console.log("App uploaded to server")
  console.log(`Try it in mobile app: ${host}/app_mobile`)
  console.log(`Or set the channel ${channel} as public here: ${hostWeb}/app/package/${appid}`)
  console.log("To use with live update in your own app")
}