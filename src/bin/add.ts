import { loadConfig } from '@capacitor/cli/dist/config';
import axios, { AxiosError } from 'axios'
import commander from 'commander';
import  { readFileSync } from 'fs'; 
import { existsSync } from 'fs-extra';
import  { getType } from 'mime'; 
import { host } from './utils';

export const addApp = async (appid: string, options: any) => {
  let { apikey, name, icon } = options;
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    console.log('No capacitor config file found');
    throw new commander.CommanderError(2, 'No capacitor config file found', err)
  }
  appid = appid ? appid : config?.app?.appId
  name = name ? name : config?.app?.appName || 'Unknown'
  icon = icon ? icon : "resources/icon.png" // default path for capacitor app
  if (!apikey) {
    throw new commander.CommanderError(2, 'Missing api , API key', 'You need to provide an API key to delete your app')
  }
  if(!appid || !name) {
    throw new commander.CommanderError(2, 'Missing argument', 'You need to provide a appid and a name, or be in a capacitor project')
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
    if (res.status !== 200) {
      throw new commander.CommanderError(2, 'Server Error',  res.data)
    }
    console.log("App added to server, you can upload a version now")
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError
      console.log('Cannot add app', axiosErr.message, axiosErr.response?.data);
    } else {
      console.log('Cannot add app', err);
    }
    throw new commander.CommanderError(2, 'Cannot add app', err)
  }
}
