import { program } from 'commander';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { existsSync } from 'fs-extra';
import { getType } from 'mime';
import { definitions } from './types_supabase'
import { getConfig, createSupabaseClient, formatError, findSavedKey, hostWeb, checkPlan } from './utils';

interface Options {
  apikey: string;
  name?: string;
  icon?: string;
}
const newIconPath = "assets/icon.png"
export const addApp = async (appid: string, options: Options) => {
  let { name, icon } = options;
  const apikey = options.apikey || findSavedKey()
  const config = await getConfig();
  appid = appid || config?.app?.appId
  name = name || config?.app?.appName || 'Unknown'
  icon = icon || "resources/icon.png" // default path for capacitor app
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to add your app");
  }
  if (!appid || !name) {
    program.error("Missing argument, you need to provide a appid and a name, or be in a capacitor project");
  }
  console.log(`Add ${appid} to Capgo`);

  const supabase = createSupabaseClient(apikey)

  // checking if user has access before uploading image
  const { data: apiAccess, error: apiAccessError } = await supabase
    .rpc('is_allowed_capgkey', { apikey, keymode: ['write', 'all'] })

  if (!apiAccess || apiAccessError) {
    console.log('Invalid API key or insufficient permissions');
    return
  }

  console.log('Adding...');
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

  const { data: dataUser, error: userIdError } = await supabase
    .rpc<string>('get_user_id', { apikey })

  const userId = dataUser ? dataUser.toString() : '';

  if (!userId || userIdError) {
    program.error(`Cannot verify user ${formatError(userIdError)}`);
  }
  await checkPlan(supabase, userId)
  // check if app already exist
  const { data: app, error: dbError0 } = await supabase
    .rpc<string>('exist_app', { appid, apikey })
  if (app || dbError0) {
    program.error(`App already exists ${formatError(dbError0)}`)
  }

  const fileName = `icon_${randomUUID()}`
  let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'

  // upload image if available
  if (iconBuff && iconType) {
    const { error } = await supabase.storage
      .from(`images/${userId}/${appid}`)
      .upload(fileName, iconBuff, {
        contentType: iconType,
      })
    if (error) {
      program.error(`Could not add app ${formatError(error)}`);
    }
    const { data: signedURLData } = await supabase
      .storage
      .from(`images/${userId}/${appid}`)
      .getPublicUrl(fileName)
    signedURL = signedURLData?.publicURL || signedURL
  }

  // add app to db
  const { error: dbError } = await supabase
    .from<definitions['apps']>('apps')
    .insert({
      icon_url: signedURL,
      user_id: userId,
      name,
      app_id: appid,
    }, { returning: "minimal" })
  if (dbError) {
    program.error(`Could not add app ${formatError(dbError)}`);
  }
  console.log("App added to server, you can upload a version now")
}
