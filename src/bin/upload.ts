import { loadConfig } from '@capacitor/cli/dist/config';
import AdmZip from 'adm-zip';
import axios from 'axios'
import { host } from './utils';

export const uploadVersion = async (appid, options) => {
  let { apikey, version, path, production } = options;
  let config;
  try {
    config = await loadConfig();
  } catch {
    console.log('No capacitor config file found');
  }
  appid = appid ? appid : config?.app?.appId
  version = version ? version : config?.app?.package?.version
  path = path ? path : config?.app?.webDir
  if (!apikey) {
    console.log('You need to provide an API key to upload your app');
    return;
  }
  if(!appid || !version || !path) {
    console.log('You need to provide a appid a version and a path or be in a capacitor project');
    return;
  }
  console.log(`Upload ${appid}@${version} from path ${path}`);
  try {
    const zip = new AdmZip();
    zip.addLocalFolder(path);
    console.log('Uploading...');
    const res = await axios.post(`${host}/api/upload`, {
      version,
      appid,
      mode: production ? 'prod' : 'dev',
      app: zip.toBuffer().toString('base64')
    }, {
    headers: {
      'authorization': apikey
    }})
    res.status === 200 ? console.log("App sent to server, Check Capacitor Go ap to test it") : console.log("Error", res.status, res.data);
  } catch (err) {
    console.log('Cannot upload app', err);
  }
}
