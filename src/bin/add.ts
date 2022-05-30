import { program } from 'commander';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { existsSync } from 'fs-extra';
import { getType } from 'mime';
import { getConfig, checkAppOwner, createSupabaseClient } from './utils';

interface AppAdd {
  appid: string;
  name: string;
  icon?: string;
  iconType?: string;
}
interface Options {
  apikey: string;
  name?: string;
  icon?: string;
}
const newIconPath = "assets/icon.png"
export const addApp = async (appid: string, options: Options) => {
  let { name, icon } = options;
  const { apikey } = options;
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
    console.log('Invalid API key');
    return
  }

  console.log('Adding...');
  const data: AppAdd = { appid, name }
  if (icon && existsSync(icon)) {
    const iconBuff = readFileSync(icon);
    const contentType = getType(icon);
    data.icon = iconBuff.toString('base64');
    data.iconType = contentType || 'image/png';
  }
  else if (existsSync(newIconPath)) {
    const iconBuff = readFileSync(newIconPath);
    const contentType = getType(newIconPath);
    data.icon = iconBuff.toString('base64');
    data.iconType = contentType || 'image/png';
  } else {
    console.warn(`Cannot find app icon in any of the following locations: ${icon}, ${newIconPath}`);
  }

  const { data: dataUser, error: userIdError } = await supabase
    .rpc<string>('get_user_id', { apikey })

  const userId = dataUser ? dataUser.toString() : '';

  if (!userId || userIdError) {
    console.error('Cannot verify user');
    return
  }

  // check if app already exist
  if (await checkAppOwner(supabase, userId, appid)) {
    console.error('App already exists')
    return;
  }

  const fileName = `icon_${randomUUID()}`
  let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'

  // upload image if available
  if (data.icon && data.iconType) {
    const { error } = await supabase.storage
      .from(`images/${userId}/${appid}`)
      .upload(fileName, data.icon, {
        contentType: data.iconType,
      })
    if (error) {
      console.error('Could not add app.', error)
      return
    }
    const { data: signedURLData } = await supabase
      .storage
      .from(`images/${userId}/${appid}`)
      .getPublicUrl(fileName)
    signedURL = signedURLData?.publicURL || signedURL
  }

  // add app to db
  const { error: dbError } = await supabase
    .from('apps')
    .insert({
      icon_url: signedURL,
      user_id: userId,
      name,
      app_id: appid,
    })
  if (dbError) {
    console.error('Could not add app.', dbError)
    return
  }
  console.log("App added to server, you can upload a version now")
}
