import program from 'commander';
import { loadConfig } from '@capacitor/cli/dist';
import AdmZip from 'adm-zip';
import axios from 'axios'

program
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-p, --production <production>', 'set version for production')
  .option('-p, --path <path>', 'path of the file to upload')
  .option('-v, --version <version>', 'version number of the file to upload')
  .option('-i, --appid <appid>', 'app id of the app to upload');

program.parse(process.argv);
const options = program.opts();

start();
async function start() {
  let { appid, apikey, version, path, production } = options;
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
    console.log('You need to provide a name a version and a path or be in a capacitor project');
    return;
  }
  console.log(`Upload ${appid}@${version} from path ${path}`);
  try {
    const zip = new AdmZip();
    zip.addLocalFolder(path);
    console.log('Uploading...');
    const host = "https://capacitorgo.com"
    // const host = "http://localhost:3334"
    const res = await axios.post(`${host}/api/upload`, {
      version,
      appid,
      mode: production ? 'prod' : 'dev',
      app: zip.toBuffer().toString('base64')
    }, {
    headers: {
      'authorization': apikey
    }})
    console.log("App sent to server, Check Capacitor Go ap too test it");
  } catch (err) {
    console.log('Cannot upload app', err);
  }
}
