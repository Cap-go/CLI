import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import { readFileSync } from 'fs';
import { existsSync } from 'fs-extra';
import { getType } from 'mime';
import { getConfig, hostSupa, supaAnon } from './utils';

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
  if (icon && existsSync(icon)) {
    const iconBuff = readFileSync(icon);
    const contentType = getType(icon);
    data.icon = iconBuff.toString('base64');
    data.iconType = contentType || 'image/png';
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
