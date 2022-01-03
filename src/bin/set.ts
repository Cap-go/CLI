import { loadConfig } from '@capacitor/cli/dist/config';
import axios, { AxiosError } from 'axios'
import { host } from './utils';

export const setVersion = async (appid, version, channel, options) => {
  let { apikey, production } = options;
  let config;
  try {
    config = await loadConfig();
  } catch {
    console.log('No capacitor config file found');
  }
  appid = appid ? appid : config?.app?.appId
  channel = channel || 'dev'
  version = version ? version : config?.app?.package?.version
  if (!apikey) {
    console.log('You need to provide an API key to upload your app');
    return;
  }
  if(!appid || !version) {
    console.log('You need to provide a appid and a version or be in a capacitor project');
    return;
  }
  console.log(`Set ${appid}@${version} to ${channel}`);
  try {
    const res = await axios.post(`${host}/api/channel`, {
      version,
      appid,
      channel,
    }, {
    headers: {
      'authorization': apikey
    }})
    res.status === 200 ? console.log(`Version set to ${channel}`) : console.log("Error", res.status, res.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError
      console.log('Cannot set version to channel', axiosErr.message, axiosErr.response?.data);
    } else {
      console.log('Cannot set version to channel', err);
    }
  }
}
