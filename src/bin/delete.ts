import { loadConfig } from '@capacitor/cli/dist/config';
import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import { supaAnon, hostDelete } from './utils';

export const deleteApp = async (appid: string, options: any) => {
  const { apikey, version } = options;
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    program.error("No capacitor config file found, run `cap init` first");
  }
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
      url: hostDelete,
      data: { appid, version },
      validateStatus: () => true,
      headers: {
        'apikey': apikey,
        'authorization': `Bearer ${supaAnon}`
      }
    })
  } catch (err) {
    program.error(`Network Error \n${prettyjson.render(err.response.data)}`);
  }
  if (!res || res.status !== 200) {
    program.error(`Server Error \n${prettyjson.render(res.data)}`);
  }
  console.log("App deleted to server")
}
