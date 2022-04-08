import { loadConfig } from '@capacitor/cli/dist/config';
import AdmZip from 'adm-zip';
import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import cliProgress from 'cli-progress';
import { host, hostWeb, hostUpload, supaAnon } from './utils';

const oneMb = 1048576; // size of one mb
const maxMb = 30;
const limitMb = oneMb * maxMb; // size of 1/2 mb
const formatType = 'binary';

export const uploadVersion = async (appid, options) => {
  let { version, path, channel } = options;
  const { apikey, external } = options;
  channel = channel || 'dev';
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    program.error("No capacitor config file found, run `cap init` first");
  }
  appid = appid || config?.app?.appId
  version = version || config?.app?.package?.version
  path = path || config?.app?.webDir
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to add your app");
  }
  if(!appid || !version || !path) {
    program.error("Missing argument, you need to provide a appid and a version and a path, or be in a capacitor project");
  }
  console.log(`Upload ${appid}@${version} started from path "${path}" to Capgo cloud`);
  if (external) {
    try {
      const res = await axios({
        method: 'POST',
        url: hostUpload,
        data: {
          version,
          appid,
          channel,
          external,
        },
        validateStatus: () => true,
        headers: {
          'Content-Type': 'application/json',
          'apikey': apikey,
          authorization : `Bearer ${supaAnon}`
        }})
      if (res.status !== 200) {
        program.error(`Server Error \n${prettyjson.render(res?.data || "")}`);
      }
    } catch (err) {
      if (err.response) {
        program.error(`Network Error \n${prettyjson.render(err.response?.data || "")}`)
      } else {
        program.error(`Network Error \n${prettyjson.render(err || "")}`)
      }
    }
  } else {
    const b1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_grey);
    try {
      const zip = new AdmZip();
      zip.addLocalFolder(path);
      console.log('Uploading:');
      const appData = zip.toBuffer().toString(formatType);
      // split appData in chunks and send them sequentially with axios
      const chunkSize = oneMb;
      if (appData.length > limitMb) {
        program.error(`The app is too big, the limit is ${maxMb} Mb`);
      }
      const chunks = [];
      for (let i = 0; i < appData.length; i += chunkSize) {
        chunks.push(appData.slice(i, i + chunkSize));
      }
      b1.start(chunks.length, 0, {
        speed: "N/A"
      });
      let fileName
      for (let i = 0; i < chunks.length; i +=1) {
        const res = await axios({
          method: 'POST',
          url: hostUpload,
          data: {
            version,
            appid,
            fileName,
            channel,
            format: formatType,
            app: chunks[i],
            isMultipart: chunks.length > 1,
            chunk: i + 1,
            totalChunks: chunks.length,
          },
          validateStatus: () => true,
          headers: {
            'Content-Type': 'application/json',
            'apikey': apikey,
            authorization : `Bearer ${supaAnon}`
          }})
        if (res.status !== 200) {
          b1.stop();
          program.error(`Server Error \n${prettyjson.render(res?.data || "")}`);
        }
        b1.update(i+1)
        fileName = res.data.fileName
      }
      b1.stop();
    } catch (err) {
      b1.stop();
      if (err.response) {
        program.error(`Network Error \n${prettyjson.render(err.response?.data || "")}`)
      } else {
        program.error(`Network Error \n${prettyjson.render(err || "")}`)
      }
    }
  }

  console.log("App uploaded to server")
  console.log(`Try it in mobile app: ${host}/app_mobile`)
  console.log(`Or set the channel ${channel} as public here: ${hostWeb}/app/package/${appid}`)
  console.log("To use with live update in your own app")
}