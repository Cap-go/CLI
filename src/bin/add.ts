import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import { readFileSync } from 'fs';
import { existsSync } from 'fs-extra';
import { getType } from 'mime';
import { getConfig, hostSupa, supaAnon, supabase } from './utils';

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
  let res;
  console.log('Adding...');
  const data: AppAdd = { appid, name }
  let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'
  if (icon && existsSync(icon)) {
    const iconBuff = readFileSync(icon);
    const contentType = getType(icon);
    data.icon = iconBuff.toString('base64');
    data.iconType = contentType || 'image/png';
    const { error } = await supabase.storage
      .from(`images/${user.id}/${appid}`)
      .upload(fileName, buff, {
        contentType: body.iconType,
      })
    if (error)
      return sendRes({ status: 'Cannot Add App', error }, 400)
    const res = await supabaseClient
      .storage
      .from(`images/${user.id}/${body.appid}`)
      .getPublicUrl(fileName)
    signedURL = res.data?.publicURL || signedURL
  }
  else if (existsSync(newIconPath)) {
    const iconBuff = readFileSync(newIconPath);
    const contentType = getType(newIconPath);
    data.icon = iconBuff.toString('base64');
    data.iconType = contentType || 'image/png';
  } else {
    console.warn(`Cannot find app icon in any of the following locations: ${icon}, ${newIconPath}`);
  }
  try {
    res = await axios({
      method: 'POST',
      url: `${hostSupa}/add`,
      data,
      validateStatus: () => true,
      headers: {
        'apikey': apikey,
        'authorization': `Bearer ${supaAnon}`
      }
    })
    const fileName = `icon_${globalThis.crypto.randomUUID()}`
    let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'
    if (data.icon && data.iconType) {
      const buff = Buffer.from(body.icon, 'base64')
      const { error } = await supabaseClient.storage
        .from(`images/${user.id}/${body.appid}`)
        .upload(fileName, buff, {
          contentType: body.iconType,
        })
      if (error)
        return sendRes({ status: 'Cannot Add App', error }, 400)
      const res = await supabaseClient
        .storage
        .from(`images/${user.id}/${body.appid}`)
        .getPublicUrl(fileName)
      signedURL = res.data?.publicURL || signedURL
    }
    const { error: dbError } = await supabaseClient
      .from('apps')
      .insert({
        icon_url: signedURL,
        user_id: user.id,
        name: body.name,
        app_id: body.appid,
      })
    if (dbError)
      return sendRes({ status: 'Cannot Add App', error: JSON.stringify(dbError) }, 400)
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      program.error(`Network Error \n${prettyjson.render(err.response?.data)}`);
    } else {
      program.error(`Unknow error \n${prettyjson.render(err)}`);
    }
  }
  if (!res || res.status !== 200) {
    program.error(`Server Error \n${prettyjson.render(res.data)}`);
  }
  console.log("App added to server, you can upload a version now")
}
