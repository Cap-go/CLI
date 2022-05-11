import { loadConfig } from '@capacitor/cli/dist/config';
import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import { readFileSync } from 'fs';
import { existsSync } from 'fs-extra';
import { getType } from 'mime';
import { host } from './utils';

export const addApp = async (appid: string, options: any) => {
  let { name, icon } = options;
  const { apikey } = options;
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    program.error("No capacitor config file found, run `cap init` first");
  }
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
  try {
    console.log('Adding...');
    const data: any = { appid, name }
    if (icon && existsSync(icon)) {
      const iconBuff = readFileSync(icon);
      const contentType = getType(icon);
      data.icon = iconBuff.toString('base64');
      data.iconType = contentType;
    }
    res = await axios({
      method: 'POST',
      url: `${host}/api/add`,
      data,
      validateStatus: () => true,
      headers: {
        'authorization': apikey
      }
    })
  } catch (err) {
    program.error(`Network Error \n${prettyjson.render(err.response.data)}`);
  }
  if (!res || res.status !== 200) {
    program.error(`Server Error \n${prettyjson.render(res.data)}`);
  }
  console.log("App added to server, you can upload a version now")
}
