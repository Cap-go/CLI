import { loadConfig } from '@capacitor/cli/dist/config';
import axios from 'axios'
import  { readFileSync } from 'fs'; 
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
  if (!apikey) {
    console.log('You need to provide an API key to upload your app');
    return;
  }
  if(!appid || !name) {
    console.log('You need to provide a appid and a name or be in a capacitor project');
    return;
  }
  console.log(`Add ${appid} to Capacitor Go`);
  try {
    console.log('Adding...');
    const data: any = {appid, name}
    if(icon) {
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
    console.log('Cannot upload app', err);
  }
}
