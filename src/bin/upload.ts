import { loadConfig } from '@capacitor/cli/dist/config';
import AdmZip from 'adm-zip';
import axios, { AxiosError } from 'axios'
import { host } from './utils';
import cliProgress from 'cli-progress';

const oneMb = 1048576;
export const uploadVersion = async (appid, options) => {
  let { apikey, version, path, channel } = options;
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
  const b1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_grey);
  try {
    const zip = new AdmZip();
    zip.addLocalFolder(path);
    console.log('Uploading...');
    const appData = zip.toBuffer();
    // split appData in chunks and send them sequentially with axios
    const chunkSize = oneMb;
    const chunks = [];
    for (let i = 0; i < appData.byteLength; i += chunkSize) {
      chunks.push(appData.slice(i, i + chunkSize).toString('base64'));
    }
    b1.start(chunks.length, 0, {
        speed: "N/A"
    });
    let fileName
    for (let i = 0; i < chunks.length; i++) {
      const res = await axios.post(`${host}/api/upload`, {
        version,
        appid,
        fileName,
        app: chunks[i],
        isMultipart: true,
        chunk: i + 1,
        totalChunks: chunks.length,
      }, {
      headers: {
        'authorization': apikey
      }})
      res.status === 200 ? b1.update(i+1) : console.log("Error", res.status, res.data);
      fileName = res.data.fileName
    }
    b1.stop();
  } catch (err) {
    b1.stop();
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError
      console.log('Cannot upload app', axiosErr.message, axiosErr.response?.data);
    } else {
      console.log('Cannot upload app', err);
    }
  }
}