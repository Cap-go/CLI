import { getType } from 'mime';
import { program } from 'commander';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs-extra';
import { checkLatest } from '../api/update';
import { checkAppExistsAndHasPermission, newIconPath, Options } from '../api/app';
import {
  getConfig, createSupabaseClient,
  findSavedKey, useLogSnag, verifyUser, formatError
} from '../utils';

export const addApp = async (appId: string, options: Options) => {
  await checkLatest();
  options.apikey = options.apikey || findSavedKey() || ''
  const config = await getConfig();
  appId = appId || config?.app?.appId
  const snag = useLogSnag()

  if (!options.apikey) {
    program.error("Missing API key, you need to provide a API key to upload your bundle");
  }
  if (!appId) {
    program.error("Missing argument, you need to provide a appId, or be in a capacitor project");
  }
  const supabase = createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all']);
  // Check we have app access to this appId
  await checkAppExistsAndHasPermission(supabase, appId, options.apikey);

  let { name, icon } = options;
  appId = appId || config?.app?.appId
  name = name || config?.app?.appName || 'Unknown'
  icon = icon || "resources/icon.png" // default path for capacitor app
  if (!icon || !name) {
    program.error("Missing argument, you need to provide a appId and a name, or be in a capacitor project");
  }
  console.log(`Adding ${appId} to Capgo`);
  let iconBuff;
  let iconType;

  if (icon && existsSync(icon)) {
    iconBuff = readFileSync(icon);
    const contentType = getType(icon);
    iconType = contentType || 'image/png';
    console.warn(`Found app icon ${icon}`);
  }
  else if (existsSync(newIconPath)) {
    iconBuff = readFileSync(newIconPath);
    const contentType = getType(newIconPath);
    iconType = contentType || 'image/png';
    console.warn(`Found app icon ${newIconPath}`);
  } else {
    console.warn(`Cannot find app icon in any of the following locations: ${icon}, ${newIconPath}`);
  }

  // check if app already exist
  const { data: app, error: dbError0 } = await supabase
    .rpc('exist_app_v2', { appid: appId })
    .single()
  if (app || dbError0) {
    program.error(`App ${appId} already exists ${formatError(dbError0)}`)
  }

  const fileName = `icon_${randomUUID()}`
  let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'

  // upload image if available
  if (iconBuff && iconType) {
    const { error } = await supabase.storage
      .from(`images/${userId}/${appId}`)
      .upload(fileName, iconBuff, {
        contentType: iconType,
      })
    if (error) {
      program.error(`Could not add app ${formatError(error)}`);
    }
    const { data: signedURLData } = await supabase
      .storage
      .from(`images/${userId}/${appId}`)
      .getPublicUrl(fileName)
    signedURL = signedURLData?.publicUrl || signedURL
  }
  // add app to db
  const { error: dbError } = await supabase
    .from('apps')
    .insert({
      icon_url: signedURL,
      user_id: userId,
      name,
      app_id: appId,
    })
  if (dbError) {
    program.error(`Could not add app ${formatError(dbError)}`);
  }
  const { error: dbVersionError } = await supabase
    .from('app_versions')
    .insert([{
      user_id: userId,
      deleted: true,
      name: 'unknown',
      app_id: appId,
    }, {
      user_id: userId,
      deleted: true,
      name: 'builtin',
      app_id: appId,
    }])
  if (dbVersionError) {
    program.error(`Could not add app ${formatError(dbVersionError)}`);
  }
  await snag.publish({
    channel: 'app',
    event: 'App Added',
    icon: '🎉',
    tags: {
      'user-id': userId,
      'app-id': appId,
    },
    notify: false,
  }).catch()
  console.log("App added to server, you can upload a bundle now")
  console.log(`Done ✅`);
  process.exit()
}
