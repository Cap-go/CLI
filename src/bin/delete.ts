import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import { supaAnon, hostSupa, getConfig } from './utils';

interface Options {
  apikey: string;
  version: string;
}

export const deleteApp = async (appid: string, options: Options) => {
  const { apikey, version } = options;
  const config = await getConfig();
  appid = appid || config?.app?.appId
  if (!apikey) {
    program.error('Missing API key, you need to provide an API key to delete your app');
  }
  if (!appid) {
    program.error('Missing argument, you need to provide a appid, or be in a capacitor project');
  }
  console.log(`Delete ${appid} to Capgo`);
  let res;
  try {
    console.log('Deleting...');
    res = await axios({
      method: 'POST',
      url: `${hostSupa}/delete`,
      data: { appid, version },
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
  console.log("App deleted to server")
}
