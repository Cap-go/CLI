import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import { getConfig, host, hostSupa, supaAnon } from './utils';

interface Options {
  apikey: string;
  version: string;
  state: string;
  channel?: string;
}

export const setChannel = async (appid: string, options: Options) => {
  const { apikey, version, state, channel = 'dev' } = options;
  const config = await getConfig();
  let res;
  appid = appid || config?.app?.appId
  let parsedState
  if (state === 'public' || state === 'private')
    parsedState = state === 'public'
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to add your app");
  }
  if (!appid) {
    program.error("Missing argument, you need to provide a appid, or be in a capacitor project");
  }
  if (!version && !parsedState) {
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
      url: `${hostSupa}/channel`,
      data: {
        version,
        public: parsedState,
        appid,
        channel,
      },
      validateStatus: () => true,
      headers: {
        'apikey': apikey,
        'authorization': `Bearer ${supaAnon}`
      }
    })
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      program.error(`Network Error \n${prettyjson.render(err.response?.data)}`);
    } else {
      program.error(`Unknow error \n${prettyjson.render(err)}`);
    }
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
