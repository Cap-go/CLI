import { loadConfig } from '@capacitor/cli/dist/config';
import axios from 'axios'
import { host } from './utils';

export const setVersion = async (appid, version, options) => {
  let { apikey, production } = options;
  let config;
  try {
    config = await loadConfig();
  } catch {
    console.log('No capacitor config file found');
  }
  appid = appid ? appid : config?.app?.appId
  version = version ? version : config?.app?.package?.version
  if (!apikey) {
    console.log('You need to provide an API key to upload your app');
    return;
  }
  if(!appid || !version) {
    console.log('You need to provide a appid and a version or be in a capacitor project');
    return;
  }
  console.log(`Set ${appid}@${version} to ${production ? 'prod' : 'dev'}`);
  try {
    const res = await axios.post(`${host}/api/mode`, {
      version,
      appid,
      mode: production ? 'prod' : 'dev'
    }, {
    headers: {
      'authorization': apikey
    }})
    res.status === 200 ? console.log(`Version set to ${production ? 'prod' : 'dev'}`) : console.log("Error", res.status, res.data);
  } catch (err) {
    console.log('Cannot upload app', err);
  }
}
