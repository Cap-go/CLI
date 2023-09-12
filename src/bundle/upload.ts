import { randomUUID } from 'crypto';
import { existsSync, readFileSync, mkdirSync, unlinkSync } from 'fs';
import fs from 'fs-extra'
import semver from 'semver/preload';
import AdmZip from 'adm-zip';
import { program } from 'commander';
import * as p from '@clack/prompts';
import { checksum as getChecksum } from '@tomasklaen/checksum';
import ciDetect from 'ci-info';
import axios from "axios";
import { checkLatest } from '../api/update';
import { OptionsBase } from '../api/utils';
import { checkAppExistsAndHasPermissionErr } from "../api/app";
import { encryptSource } from '../api/crypto';
import {
  hostWeb, getConfig, createSupabaseClient,
  uploadUrl,
  updateOrCreateChannel, updateOrCreateVersion,
  formatError, findSavedKey, checkPlanValid,
  useLogSnag, verifyUser, regexSemver, baseKeyPub, convertAppName, defaulPublicKey,
  isPartialUpdate, getPartialUpdateBaseVersion, downloadFile, filterImageFiles, removeExistingImageFiles, safeBundle
} from '../utils';

const alertMb = 20;

interface Options extends OptionsBase {
  bundle?: string
  path?: string
  channel?: string
  displayIvSession?: boolean
  external?: string
  key?: boolean | string,
  bundleUrl?: boolean
}

export const uploadBundle = async (appid: string, options: Options, shouldExit = true) => {
  p.intro(`Uploading`);
  await checkLatest();
  let { bundle, path, channel } = options;
  const { external, key = false, displayIvSession } = options;
  const apikey = options.apikey || findSavedKey()
  const snag = useLogSnag()

  channel = channel || 'dev';

  const config = await getConfig();
  const localS3: boolean = (config.app.extConfig.plugins && config.app.extConfig.plugins.CapacitorUpdater
    && config.app.extConfig.plugins.CapacitorUpdater.localS3) === true;

  appid = appid || config?.app?.appId
  // create bundle name format : 1.0.0-beta.x where x is a uuid
  const uuid = randomUUID().split('-')[0];
  bundle = bundle || config?.app?.package?.version || `0.0.1-beta.${uuid}`
  // check if bundle is valid 
  if (!regexSemver.test(bundle)) {
    p.log.error(`Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`);
    program.error('');
  }
  path = path || config?.app?.webDir
  if (!apikey) {
    p.log.error(`Missing API key, you need to provide a API key to upload your bundle`);
    program.error('');
  }
  if (!appid || !bundle || !path) {
    p.log.error("Missing argument, you need to provide a appid and a bundle and a path, or be in a capacitor project");
    program.error('');
  }
  // check if path exist
  if (!existsSync(path)) {
    p.log.error(`Path ${path} does not exist, build your app first, or provide a valid path`);
    program.error('');
  }
  p.log.info(`Upload ${appid}@${bundle} started from path "${path}" to Capgo cloud`);

  const supabase = createSupabaseClient(apikey)
  const userId = await verifyUser(supabase, apikey, ['write', 'all', 'upload']);
  await checkPlanValid(supabase, userId, false)
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionErr(supabase, appid);

  const { data: isTrial, error: isTrialsError } = await supabase
    .rpc('is_trial', { userid: userId })
    .single()
  if (isTrial && isTrial > 0 || isTrialsError) {
    p.log.warn(`WARNING !!\nTrial expires in ${isTrial} days`);
    p.log.warn(`Upgrade here: ${hostWeb}/dashboard/settings/plans`);
  }

  // check if app already exist
  const { data: appVersion, error: appVersionError } = await supabase
    .rpc('exist_app_versions', { appid, apikey, name_version: bundle })
    .single()

  if (appVersion || appVersionError) {
    p.log.error(`Version already exists ${formatError(appVersionError)}`);
    program.error('');
  }

  const fileName = safeBundle(bundle);

  let sessionKey;
  let checksum = ''
  let zipped: Buffer | null = null;
  if (!external) {
    const zip = new AdmZip();
    zip.addLocalFolder(path);
    zipped = zip.toBuffer();
    const s = p.spinner()
    s.start(`Calculating checksum`);
    checksum = await getChecksum(zipped, 'crc32');
    s.stop(`Checksum: ${checksum}`);
    if (key || existsSync(baseKeyPub)) {
      const publicKey = typeof key === 'string' ? key : baseKeyPub
      let keyData = ''
      // check if publicKey exist
      if (!existsSync(publicKey)) {
        p.log.error(`Cannot find public key ${publicKey}`);
        if (ciDetect.isCI) {
          program.error('');
        }
        const res = await p.confirm({ message: 'Do you want to use our public key ?' })
        if (!res) {
          p.log.error(`Error: Missing public key`);
          program.error('');
        }
        keyData = defaulPublicKey
      }
      await snag.publish({
        channel: 'app',
        event: 'App encryption',
        icon: '🔑',
        tags: {
          'user-id': userId,
          'app-id': appid,
        },
        notify: false,
      }).catch()
      // open with fs publicKey path
      const keyFile = readFileSync(publicKey)
      keyData = keyFile.toString()
      // encrypt
      p.log.info(`Encrypting your bundle`);
      const res = encryptSource(zipped, keyData)
      sessionKey = res.ivSessionKey
      if (displayIvSession) {
        p.log.info(`Your Iv Session key is ${sessionKey},
keep it safe, you will need it to decrypt your bundle.
It will be also visible in your dashboard\n`);
      }
      zipped = res.encryptedData
    }
    const mbSize = Math.floor(zipped.byteLength / 1024 / 1024);
    if (mbSize > alertMb) {
      p.log.warn(`WARNING !!\nThe app size is ${mbSize} Mb, this may take a while to download for users\n`);
      p.log.info(`Learn how to optimize your assets https://capgo.app/blog/optimise-your-images-for-updates/\n`);
      await snag.publish({
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
  } else if (external && !external.startsWith('https://')) {
    p.log.error(`External link should should start with "https://" current is "${external}"`);
    program.error('');
  } else {
    await snag.publish({
      channel: 'app',
      event: 'App external',
      icon: '📤',
      tags: {
        'user-id': userId,
        'app-id': appid,
      },
      notify: false,
    }).catch()
  }
  const versionData = {
    bucket_id: external ? undefined : fileName,
    user_id: userId,
    name: bundle,
    app_id: appid,
    session_key: sessionKey,
    external_url: external,
    storage_provider: external ? 'external' : 'r2-direct',
    checksum,
  }
  const { error: dbError } = await updateOrCreateVersion(supabase, versionData, apikey)
  if (dbError) {
    p.log.error(`Cannot add bundle ${formatError(dbError)}`);
    program.error('');
  }
  if (!external && zipped) {
    const spinner = p.spinner();
    spinner.start(`Uploading Bundle`);

    const url = await uploadUrl(supabase, appid, fileName)
    if (!url) {
      p.log.error(`Cannot get upload url. URL is invalid (null).`);
      program.error('');
    }

    await axios({
      method: "put",
      url,
      data: zipped,
      headers: (!localS3 ? {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=456789, immutable",
        "x-amz-meta-crc32": checksum,
      } : undefined)
    })
    versionData.storage_provider = 'r2'
    const { error: dbError2 } = await updateOrCreateVersion(supabase, versionData, apikey)
    if (dbError2) {
      p.log.error(`Cannot update bundle ${formatError(dbError)}`);
      program.error('');
    }
    spinner.stop('Bundle Uploaded 💪')
  }
  const { data: versionId } = await supabase
    .rpc('get_app_versions', { apikey, name_version: bundle, appid })
    .single()
  if (versionId) {
    const { error: dbError3, data } = await updateOrCreateChannel(supabase, {
      name: channel,
      app_id: appid,
      created_by: userId,
      version: versionId,
    })
    if (dbError3) {
      p.log.error(`Cannot set channel, the upload key is not allowed to do that, use the "all" for this.`);
      program.error('');
    }
    const appidWeb = convertAppName(appid)
    const bundleUrl = `${hostWeb}/app/p/${appidWeb}/channel/${data.id}`
    if (data?.public) {
      p.log.info('Your update is now available in your public channel 🎉')
    } else if (data?.id) {
      p.log.info(`Link device to this bundle to try it: ${bundleUrl}`);
    }

    if (options.bundleUrl) {
      p.log.info(`Bundle url: ${bundleUrl}`);
    }
  } else {
    p.log.warn('Cannot set bundle with upload key, use key with more rights for that');
    program.error('');
  }
  await snag.publish({
    channel: 'app',
    event: 'App Uploaded',
    icon: '⏫',
    tags: {
      'user-id': userId,
      'app-id': appid,
    },
    notify: false,
  }).catch()
  if (shouldExit) {
    p.outro('Time to share your update to the world 🌍')
    process.exit()
  }
  return true
}

export const uploadCommand = async (appid: string, options: Options) => {
  try {
    await uploadBundle(appid, options, false)

    // check if the partial-update flag is set in capacitor.config.json
    if (await isPartialUpdate()) {
      p.log.info(`The partial-update flag was set. Preparing to perform a partial update.`);

      const partialUpdateBaseVersion = await getPartialUpdateBaseVersion()
      if (partialUpdateBaseVersion) {
        await uploadPartialUpdateCommand(appid, options, true)
      }
    } else {
      p.outro('Time to share your update to the world 🌍')
      process.exit()
    }
  } catch (error) {
    p.log.error(JSON.stringify(error))
    program.error('')
  }
}

export const uploadDeprecatedCommand = async (apikey: string, options: Options) => {
  p.log.warn('⚠️  This command is deprecated, use "npx @capgo/cli bundle upload" instead ⚠️')
  try {
    await uploadBundle(apikey, options, true)
  } catch (error) {
    p.log.error(JSON.stringify(error))
    program.error('')
  }
}

export const uploadPartialUpdateCommand = async (appid: string, options: Options, shouldExit = true) => {
  const config = await getConfig();
  let { bundle, path, channel } = options;
  appid = appid || config?.app?.appId
  bundle = bundle || config?.app?.package?.version
  path = path || config?.app?.webDir
  channel = channel || 'dev';
  const { external, key = false, displayIvSession } = options;

  if (existsSync(path)) {
    const baseVersion = await getPartialUpdateBaseVersion()
    if (!baseVersion) {
      p.log.error(`The partial-update base version you specified is invalid: ${baseVersion}`);
      program.error('')
    } else {
      p.log.info(`The partial-update base version you specified is: ${baseVersion}`);

      if (!semver.lt(baseVersion, bundle)) {
        p.log.info(`The partial-update base version (${baseVersion}) you specified must be lower than the current version (${bundle})`);
        program.error('')
      }
    }
    const baseVersionPath = `${path}/../manifest/dist_${baseVersion}-base`
    const partialVersionPath = `${path}/../manifest/dist_${baseVersion}-partial`

    try {
      mkdirSync(baseVersionPath, { recursive: true })
      mkdirSync(partialVersionPath, { recursive: true })

      if (existsSync(baseVersionPath) && existsSync(partialVersionPath)) {
        const apikey = options.apikey || findSavedKey()
        const supabase = createSupabaseClient(apikey)
        // check if specified base version does indeed exist
        const { data: baseVersionDB, error: baseVersionDBError } = await supabase
          .rpc('exist_app_versions', { appid, apikey, name_version: baseVersion })
          .single()

        if (!baseVersionDB) {
          p.log.error(`The bundle version on which to base the partial-update does not exist ${formatError(baseVersionDBError)}`);
          program.error('');
        }

        // download the base version to the disk
        const { data: baseData, error: baseError } = await supabase
          .from('channels')
          .select()
          .eq('app_id', appid)
          .eq('name', channel)
          // .eq('created_by', update.created_by)
          .single()

        if (!baseData) {
          p.log.error(`The base version you specified for a partial-update does not exist on the server: ${baseError}`);
          program.error('')
        }

        const userId = await verifyUser(supabase, apikey, ['write', 'all', 'upload']);
        const data = {
          api_key: apikey,
          user_id: userId,
          app_id: appid,
          storage_provider: external ? 'external' : 'r2',
          bucket_id: external ? undefined : safeBundle(bundle),
        }

        // console.log(`Bundle URL payload: ${JSON.stringify(data)}`)
        const res = await supabase.functions.invoke('download_link', { body: JSON.stringify(data) })
        const bundleUrl = res.data ? res.data.url : undefined
        p.log.info(`Bundle url: ${bundleUrl}`);

        if (!bundleUrl) {
          p.log.error(`The base version you specified for a partial-update could not be downloaded: ${bundleUrl}`);
          program.error('')
        }

        // write to disk
        const downloadFilePath = `${path}/../manifest/dist_${baseVersion}-base.zip`;
        await downloadFile(bundleUrl, downloadFilePath);
        if (!existsSync(downloadFilePath)) {
          p.log.error(`The base version you specified could not be downloaded`);
          program.error('')
        }

        const zip = new AdmZip(downloadFilePath);
        zip.extractAllTo(baseVersionPath, true);
        unlinkSync(downloadFilePath)

        // copy the current bundle folder to the partial bundle folder
        fs.copySync(path, partialVersionPath, { overwrite: true })

        const existingImageFiles = await filterImageFiles(path);
        console.log('Matching image files:', existingImageFiles);
        if (existingImageFiles && existingImageFiles.length > 0) {
          removeExistingImageFiles(partialVersionPath, existingImageFiles)
        }
      }
    } catch (error) {
      let e: Error = error as Error
      p.log.error(`Error: ${JSON.stringify(e.stack)}`);
      program.error('');
    }

    options.bundle = `${bundle}-partial`
    options.path = partialVersionPath
    p.log.info(`CLI options updated for partial-updates: ${JSON.stringify(options)}`)

    // next, perform the partial update
    await uploadBundle(appid, options, true)
  } else {
    p.log.error(`Cannot find the path to the full bundle to be partially updated. Did you delete it?`);
    program.error('');
  }
}