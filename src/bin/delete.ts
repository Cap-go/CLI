import { loadConfig } from '@capacitor/cli/dist/config';
import axios, { AxiosError } from 'axios'
import { host } from './utils';

export const deleteApp = async (appid: string, options: any) => {
  let { apikey } = options;
  let config;
  try {
    config = await loadConfig();
  } catch {
    console.log('No capacitor config file found');
  }
  appid = appid ? appid : config?.app?.appId
  if (!apikey) {
    console.log('You need to provide an API key to delete your app');
    return;
  }
  if(!appid) {
    console.log('You need to provide a appid or be in a capacitor project');
    return;
  }
  console.log(`Add ${appid} to Capgo`);
  try {
    console.log('Deleting...');
    const data: any = {appid}
    const res = await axios.post(`${host}/api/delete`, data, {
    headers: {
      'authorization': apikey
    }})
    res.status === 200 ? console.log("App deleted to server") : console.log("Error", res.status, res.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError
      console.log('Cannot delete app', axiosErr.message, axiosErr.response?.data);
    } else {
      console.log('Cannot delete app', err);
    }
  }
}
