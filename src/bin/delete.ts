import { loadConfig } from '@capacitor/cli/dist/config';
import axios, { AxiosError } from 'axios'
import commander from 'commander';
import { host } from './utils';

export const deleteApp = async (appid: string, options: any) => {
  let { apikey } = options;
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    console.log('No capacitor config file found');
    throw new commander.CommanderError(2, 'No capacitor config file found', err)
  }
  appid = appid ? appid : config?.app?.appId
  if (!apikey) {
    throw new commander.CommanderError(2, 'Missing api , API key', 'You need to provide an API key to delete your app')
  }
  if(!appid) {
    throw new commander.CommanderError(2, 'Missing argument', 'You need to provide a appid, or be in a capacitor project')
  }
  console.log(`Delete ${appid} to Capgo`);
  try {
    console.log('Deleting...');
    const data: any = {appid}
    const res = await axios.post(`${host}/api/delete`, data, {
    headers: {
      'authorization': apikey
    }})
    if (res.status !== 200) {
      throw new commander.CommanderError(2, 'Server Error',  res.data)
    }
    console.log("App deleted to server") 
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError
      console.log('Cannot delete app', axiosErr.message, axiosErr.response?.data);
    } else {
      console.log('Cannot delete app', err);
    }
    throw new commander.CommanderError(2, 'Cannot delete app', err)
  }
}
