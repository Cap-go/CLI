import { loadConfig } from '@capacitor/cli/dist/config';
import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import { host } from './utils';

export const setVersion = async (appid, version, channel, options) => {
  const { apikey } = options;
  let config;
  let res;
  try {
    config = await loadConfig();
  } catch (err) {
    program.error("No capacitor config file found, run `cap init` first");
  }
  appid = appid || config?.app?.appId
  channel = channel || 'dev'
  version = version || config?.app?.package?.version
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to add your app");
  }
  if(!appid || !version) {
    program.error("Missing argument, you need to provide a appid and a version, or be in a capacitor project");
  }
  console.log(`Set ${appid}@${version} to ${channel}`);
  try {
    res = await axios({
      method: 'POST',
      url:`${host}/api/channel`,
      data: {
        version,
        appid,
        channel,
      },
      validateStatus: () => true,
      headers: {
        'authorization': apikey
      }})
  } catch (err) {
    program.error(`Network Error \n${prettyjson.render(err.response.data)}`);
  }
  if (!res || res.status !== 200) {
    program.error(`Server Error \n${prettyjson.render(res.data)}`);
  }
  console.log(`Version set to ${channel}`)
}
