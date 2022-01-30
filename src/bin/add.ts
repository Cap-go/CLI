import { loadConfig } from '@capacitor/cli/dist/config';
import axios, { AxiosError } from 'axios'
import  { readFileSync } from 'fs'; 
import { existsSync } from 'fs-extra';
import  { getType } from 'mime'; 
import { host } from './utils';

export const addApp = async (appid: string, options: any) => {
  let { apikey, name, icon } = options;
  let config;
  try {
    config = await loadConfig();
  } catch {
    console.log('No capacitor config file found');
  }
  appid = appid ? appid : config?.app?.appId
  name = name ? name : config?.app?.appName || 'Unknown'
  icon = icon ? icon : "resources/icon.png" // default path for capacitor app
  if (!apikey) {
    console.log('You need to provide an API key to upload your app');
    return;
  }
  if(!appid || !name) {
    console.log('You need to provide a appid and a name or be in a capacitor project');
    return;
  }
  console.log(`Add ${appid} to Capgo`);
  try {
    console.log('Adding...');
    const data: any = { appid, name }
    if(icon && existsSync(icon)) {
      const iconBuff = readFileSync(icon);
      const contentType = getType(icon);
      data.icon = iconBuff.toString('base64');
      data.iconType = contentType;
    }
    const res = await axios.post(`${host}/api/add`, data, {
    headers: {
      'authorization': apikey
    }})
    res.status === 200 ? console.log("App added to server, you can upload a version now") : console.log("Error", res.status, res.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError
      console.log('Cannot add app', axiosErr.message, axiosErr.response?.data);
    } else {
      console.log('Cannot add app', err);
    }
  }
}
