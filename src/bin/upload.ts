import { loadConfig } from '@capacitor/cli/dist/config';
import AdmZip from 'adm-zip';
import axios from 'axios';
import prettyjson from 'prettyjson';
import { program } from 'commander';
import cliProgress from 'cli-progress';
import { host, hostWeb, hostUpload, supaAnon } from './utils';
import axiosRetry from 'axios-retry';

axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });
const oneMb = 1048576; // size of one mb in bytes
const maxMb = 30;
const alertMb = 25;
// enum string format
enum UploadFormat {
  uft8 = 'utf8',
  base64 = 'base64',
  hex = 'hex',
  binary = 'binary'
}
interface uploadPayload {
  version: string
  appid: string
  fileName: string
  channel: string
  format: UploadFormat
  app: string,
  isMultipart: boolean,
  chunk: number,
  totalChunks: number,
}

const formatDefault: UploadFormat = 'binary' as UploadFormat;
const chuckNumber = (l: number, divider: number) => l < divider ? l : Math.floor(l / divider)
const chuckSize = (l: number, divider: number) => Math.floor(l / chuckNumber(l, divider))

const mbConvert = {
  'base64': (l: number) => ((l * 4) / 3),
  'hex': (l: number) => l * 2,
  'binary': (l: number) => l,
  'utf8': (l: number) => l,
}

const sendToBack = async (data: uploadPayload, apikey: string) => {
  const res = await axios({
    method: 'POST',
    url: hostUpload,
    data,
    validateStatus: () => true,
    headers: {
      'Content-Type': 'application/json',
      'apikey': apikey,
      authorization: `Bearer ${supaAnon}`
    }
  })
  return res
}

export const uploadVersion = async (appid, options) => {
  let { version, path, channel } = options;
  const { apikey, external, format } = options;
  channel = channel || 'dev';
  let config;
  let formatType = formatDefault;
  if (format in UploadFormat) {
    formatType = format as UploadFormat;
  }
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
  if (!appid || !version || !path) {
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
          authorization: `Bearer ${supaAnon}`
        }
      })
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
    const b1 = new cliProgress.SingleBar({
      format: 'Uploading: [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} Mb'
    }, cliProgress.Presets.shades_grey);
    try {
      const zip = new AdmZip();
      zip.addLocalFolder(path);
      const zipped = zip.toBuffer();
      const appData = zipped.toString(formatType);
      // split appData in chunks and send them sequentially with axios
      // console.log('appData size', appData.length)
      const zippedSize = appData.length;
      const mbSize = Math.floor(zippedSize / mbConvert[formatType](oneMb));
      // console.log('mbSize', zippedSize, mbSize, mbConvert[formatType](oneMb))
      const chunkSize = chuckSize(zippedSize, mbConvert[formatType](oneMb));
      if (mbSize > maxMb) {
        program.error(`The app is too big, the limit is ${maxMb} Mb, your is ${mbSize} Mb`);
      }
      if (mbSize > alertMb) {
        console.log(`WARNING !!\nThe app size is ${mbSize} Mb, the limit is ${maxMb} Mb`);
      }
      const chunks = [];
      for (let i = 0; i < appData.length; i += chunkSize) {
        chunks.push(appData.slice(i, i + chunkSize));
      }
      b1.start(chunks.length, 0, {
        speed: "N/A"
      });
      let fileName
      for (let i = 0; i < chunks.length; i += 1) {
        const res = await sendToBack({
          version,
          appid,
          fileName,
          channel,
          format: formatType,
          app: chunks[i],
          isMultipart: chunks.length > 1,
          chunk: i + 1,
          totalChunks: chunks.length,
        }, apikey)
        if (res.status !== 200) {
          b1.stop();
          program.error(`Server Error \n${prettyjson.render(res?.data || "")}`);
        }
        b1.update(i + 1)
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