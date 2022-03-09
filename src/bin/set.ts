import { loadConfig } from '@capacitor/cli/dist/config';
import axios, { AxiosError } from 'axios'
import commander from 'commander';
import { host } from './utils';

export const setVersion = async (appid, version, channel, options) => {
  let { apikey } = options;
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    console.log('No capacitor config file found');
    throw new commander.CommanderError(2, 'No capacitor config file found', err)
  }
  appid = appid ? appid : config?.app?.appId
  channel = channel || 'dev'
  version = version ? version : config?.app?.package?.version
  if (!apikey) {
    throw new commander.CommanderError(2, 'Missing api , API key', 'You need to provide an API key to delete your app')
  }
  if(!appid || !version) {
    throw new commander.CommanderError(2, 'Missing argument', 'You need to provide a appid a version, or be in a capacitor project')
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
    if (res.status !== 200) {
      throw new commander.CommanderError(2, 'Server Error',  res.data)
    }
    console.log(`Version set to ${channel}`)
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError
      console.log('Cannot set version to channel', axiosErr.message, axiosErr.response?.data);
    } else {
      console.log('Cannot set version to channel', err);
    }
    throw new commander.CommanderError(2, 'Cannot upload app', err)
  }
}
