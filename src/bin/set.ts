import { loadConfig } from '@capacitor/cli/dist/config';
import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import { host } from './utils';

export const setChannel = async (appid, channel, options) => {
  const { apikey, version, state } = options;
  let config;
  let res;
  try {
    config = await loadConfig();
  } catch (err) {
    program.error("No capacitor config file found, run `cap init` first");
  }
  appid = appid || config?.app?.appId
  channel = channel || 'dev'
  let parsedState
  if (state === 'public' || state === 'private') 
    parsedState = state === 'public'
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to add your app");
  }
  if(!appid || !version) {
    program.error("Missing argument, you need to provide a appid, or be in a capacitor project");
  }
  if(!version && !parsedState) {
    program.error("Missing argument, you need to provide a state or a version");
  }
  if (version) {
    console.log(`Set ${channel} to @${version} in ${appid}`);
  } else {
    console.log(`Set${channel} to @${state} in ${appid}`);
  }
  try {
    res = await axios({
      method: 'POST',
      url:`${host}/api/channel`,
      data: {
        version,
        public: parsedState,
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
  if (version) {
    console.log(`Done ✅`);
  } else {
    console.log(`You can use now is channel in your app with the url: ${host}/api/latest?appid=${appid}&channel=${channel}`);
  }
}
