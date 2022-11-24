import AdmZip from 'adm-zip';
import { program } from 'commander';
import { randomUUID } from 'crypto';
import aes from 'crypto-js/aes';
import cliProgress from 'cli-progress';
import { existsSync, readFileSync } from 'fs';
import NodeRSA from 'node-rsa'
import { checksum as getChecksum } from '@tomasklaen/checksum';
import {
  host, hostWeb, getConfig, createSupabaseClient,
  updateOrCreateChannel, updateOrCreateVersion, formatError, findSavedKey, checkPlanValid, useLogSnag, verifyUser, regexSemver, baseKeyPub
} from './utils';

interface Options {
  bundle: string
  path: string
  apikey: string
  channel?: string
  external?: string
  key?: boolean | string
}

const alertMb = 20;

export const uploadVersion = async (appid: string, options: Options) => {
  let { bundle, path, channel } = options;
  const { external, key = false } = options;
  const apikey = options.apikey || findSavedKey()
  const snag = useLogSnag()

  channel = channel || 'dev';
  const config = await getConfig();
  appid = appid || config?.app?.appId
  bundle = bundle || config?.app?.package?.version
  // check if bundle is valid 
  if (!regexSemver.test(bundle)) {
    program.error(`Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`);
  }
  path = path || config?.app?.webDir
  if (!apikey) {
    program.error("Missing API key, you need to provide a API key to add your app");
  }
  if (!appid || !bundle || !path) {
    program.error("Missing argument, you need to provide a appid and a bundle and a path, or be in a capacitor project");
  }
  console.log(`Upload ${appid}@${bundle} started from path "${path}" to Capgo cloud`);

  const supabase = createSupabaseClient(apikey)
  const userId = await verifyUser(supabase, apikey, ['write', 'all', 'upload']);
  await checkPlanValid(supabase, userId, false)
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true
  }, cliProgress.Presets.shades_grey);

  // add bars
  const b1 = multibar.create(7, 0, {
    format: 'Uploading: [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} Part'
  }, cliProgress.Presets.shades_grey);
  b1.start(7, 0, {
    speed: "N/A"
  });

  // checking if user has access rights before uploading
  const { data: versionExist, error: versionExistError } = await supabase
    .rpc('exist_app_versions', { apikey, name_version: bundle, appid })

  if (versionExist || versionExistError) {
    multibar.stop()
    program.error(`This app bundle already exist or was deleted, you cannot re-upload it ${formatError(versionExistError)}`);
  }
  b1.increment();
  const { data: isTrial, error: isTrialsError } = await supabase
    .rpc<number>('is_trial', { userid: userId })
    .single()
  if (isTrial && isTrial > 0 || isTrialsError) {
    multibar.log(`WARNING !!\nTrial expires in ${isTrial} days, upgrade here: ${hostWeb}/dashboard/settings/plans\n`);
  }
  b1.increment();

  const { data: app, error: appError } = await supabase
    .rpc<string>('exist_app', { appid, apikey })
  if (!app || appError) {
    multibar.stop()
    program.error(`Cannot find app ${appid} in your account \n${formatError(appError)}`)
  }
  b1.increment();
  // check if app already exist
  const { data: appVersion, error: appVersionError } = await supabase
    .rpc<string>('exist_app_versions', { appid, apikey, name_version: bundle })
  if (appVersion || appVersionError) {
    program.error(`Version already exists ${formatError(appVersionError)}`)
  }
  b1.increment();
  const fileName = randomUUID()
  let sessionKey;
  let checksum = ''
  if (!external) {
    const zip = new AdmZip();
    zip.addLocalFolder(path);
    let zipped = zip.toBuffer();
    if (key || existsSync(baseKeyPub)) {
      const publicKey = typeof key === 'string' ? key : baseKeyPub
      // check if publicKey exist
      if (!existsSync(publicKey)) {
        program.error(`Cannot find public key ${publicKey}`)
      }
      // open with fs publicKey path
      const keyFile = readFileSync(publicKey)
      const nodeRsa = new NodeRSA(keyFile.toString())
      // check is key is private key
      if (nodeRsa.isPrivate()) {
        program.error(`Cannot use private key to encode, please use public key`)
      }
      // encrypt zip with key
      const encrypted = aes.encrypt(zipped.toString(), randomUUID())
      // encrypt session key with public key
      sessionKey = nodeRsa.encrypt(encrypted.key.toString(), 'base64')
      console.log('Session Key', encrypted.key.toString())

      // encrypted to buffer
      zipped = Buffer.from(encrypted.ciphertext.toString(), 'base64')
    }
    checksum = await getChecksum(zipped, 'crc32');
    const mbSize = Math.floor(zipped.byteLength / 1024 / 1024);
    const filePath = `apps/${userId}/${appid}/versions`
    b1.increment();
    if (mbSize > alertMb) {
      multibar.log(`WARNING !!\nThe app size is ${mbSize} Mb, this may take a while to download for users\n`);
      snag.publish({
        channel: 'app-error',
        event: 'App Too Large',
        icon: '🚛',
        tags: {
          'user-id': userId,
          'app-id': appid,
        },
        notify: false,
      }).catch()
    }

    const { error: upError } = await supabase.storage
      .from(filePath)
      .upload(fileName, zipped, {
        contentType: 'application/zip',
      })
    if (upError) {
      multibar.stop()
      program.error(`Cannot upload ${formatError(upError)}`)
    }
  } else if (external && !external.startsWith('https://')) {
    multibar.stop()
    program.error(`External link should should start with "https://" current is "${external}"`)
  }
  b1.increment();
  const { data: versionData, error: dbError } = await updateOrCreateVersion(supabase, {
    bucket_id: external ? undefined : fileName,
    user_id: userId,
    name: bundle,
    app_id: appid,
    session_key: sessionKey,
    external_url: external,
    checksum,
  }, apikey)
  if (dbError) {
    multibar.stop()
    program.error(`Cannot add bundle ${formatError(dbError)}`)
  }
  b1.increment();
  if (versionData && versionData.length) {
    const { error: dbError3 } = await updateOrCreateChannel(supabase, {
      name: channel,
      app_id: appid,
      created_by: userId,
      version: versionData[0].id,
    }, apikey)
    if (dbError3) {
      multibar.log('Cannot set bundle with upload key, use key with more rights for that\n');
    }
  } else {
    multibar.log('Cannot set bundle with upload key, use key with more rights for that\n');
  }
  multibar.stop()
  const appidWeb = appid.replace(/\./g, '--')
  console.log("App uploaded to server")
  console.log(`Try it in mobile app: ${host}/app_mobile`)
  console.log(`Or set the channel ${channel} as public here: ${hostWeb}/app/package/${appidWeb}`)
  console.log("To use with live update in your own app")
  console.log(`You can link specific device to this bundle to make user try it first, here: ${hostWeb}/app/p/${appidWeb}/devices`)
  snag.publish({
    channel: 'app',
    event: 'App Uploaded',
    icon: '⏫',
    tags: {
      'user-id': userId,
      'app-id': appid,
    },
    notify: false,
  }).catch()
}