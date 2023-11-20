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
import { checkAppExistsAndHasPermissionErr } from "../api/app";
import { encryptSource } from '../api/crypto';
import {
  OptionsBase,
  getConfig, createSupabaseClient,
  uploadUrl,
  updateOrCreateChannel, updateOrCreateVersion,
  formatError, findSavedKey, checkPlanValid,
  useLogSnag, verifyUser, regexSemver, baseKeyPub, convertAppName, getLocalConfig, checkCompatibility, requireUpdateMetadata,
  getLocalDepenencies, isPartialUpdate, getPartialUpdateBaseVersion, downloadFile, filterBinaryFiles, removeExistingBinaryFiles,
  safeBundle
} from '../utils';
import { checkIndexPosition, searchInDirectory } from './check';

const alertMb = 20;

interface Options extends OptionsBase {
  bundle?: string
  path?: string
  channel?: string
  displayIvSession?: boolean
  external?: string
  key?: boolean | string,
  keyData?: string,
  ivSessionKey?: string,
  bundleUrl?: boolean
  codeCheck?: boolean,
  minUpdateVersion?: string,
  autoMinUpdateVersion?: boolean,
  ignoreMetadataCheck?: boolean
}

export const uploadBundle = async (appid: string, options: Options, shouldExit = true) => {

  p.intro(`Uploading`);
  await checkLatest();
  let { bundle, path, channel } = options;
  const { external, key = false, displayIvSession, autoMinUpdateVersion, ignoreMetadataCheck } = options;
  let { minUpdateVersion } = options
  options.apikey = options.apikey || findSavedKey()
  const snag = useLogSnag()

  channel = channel || 'dev';

  const config = await getConfig();
  const localS3: boolean = (config.app.extConfig.plugins && config.app.extConfig.plugins.CapacitorUpdater
    && config.app.extConfig.plugins.CapacitorUpdater.localS3) === true;

  const checkNotifyAppReady = options.codeCheck
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
  if (!options.apikey) {
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

  if (typeof checkNotifyAppReady === 'undefined' || checkNotifyAppReady) {
    const isPluginConfigured = searchInDirectory(path, 'notifyAppReady')
    if (!isPluginConfigured) {
      p.log.error(`notifyAppReady() is missing in the source code. see: https://capgo.app/docs/plugin/api/#notifyappready`);
      program.error('');
    }
    const foundIndex = checkIndexPosition(path);
    if (!foundIndex) {
      p.log.error(`index.html is missing in the root folder or in the only folder in the root folder`);
      program.error('');
    }
  }

  p.log.info(`Upload ${appid}@${bundle} started from path "${path}" to Capgo cloud`);

  const localConfig = await getLocalConfig()
  const supabase = await createSupabaseClient(options.apikey)
  const userId = await verifyUser(supabase, options.apikey, ['write', 'all', 'upload']);
  await checkPlanValid(supabase, userId, false)
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionErr(supabase, options.apikey, appid);

  const updateMetadataRequired = await requireUpdateMetadata(supabase, channel)

  // Check compatibility here
  const { data: channelData, error: channelError } = await supabase
    .from('channels')
    .select('version ( minUpdateVersion, native_packages )')
    .eq('name', channel)
    .eq('app_id', appid)
    .single()

  // eslint-disable-next-line no-undef-init
  let localDependencies: Awaited<ReturnType<typeof getLocalDepenencies>> | undefined = undefined;
  let finalCompatibility: Awaited<ReturnType<typeof checkCompatibility>>['finalCompatibility'];

  // We only check compatibility IF the channel exists
  if (!channelError && channelData && channelData.version && (channelData.version as any).native_packages && !ignoreMetadataCheck) {
    const spinner = p.spinner();
    spinner.start(`Checking bundle compatibility with channel ${channel}`);
    const {
      finalCompatibility: finalCompatibilityWithChannel,
      localDependencies: localDependenciesWithChannel
    } = await checkCompatibility(supabase, appid, channel)

    finalCompatibility = finalCompatibilityWithChannel
    localDependencies = localDependenciesWithChannel

    if (finalCompatibility.find((x) => x.localVersion !== x.remoteVersion)) {
      p.log.error(`Your bundle is not compatible with the channel ${channel}`);
      p.log.warn(`You can check compatibility with "npx @capgo/cli bundle compatibility"`);

      if (autoMinUpdateVersion) {
        minUpdateVersion = bundle
        p.log.info(`Auto set min-update-version to ${minUpdateVersion}`);
      }
    } else if (autoMinUpdateVersion) {
      try {
        const { minUpdateVersion: lastMinUpdateVersion } = channelData.version as any
        if (!lastMinUpdateVersion || !regexSemver.test(lastMinUpdateVersion)) {
          p.log.error('Invalid remote min update version, skipping auto setting compatibility');
          program.error('');
        }

        minUpdateVersion = lastMinUpdateVersion
        p.log.info(`Auto set min-update-version to ${minUpdateVersion}`);
      } catch (error) {
        p.log.error(`Cannot auto set compatibility, invalid data ${channelData}`);
        program.error('');
      }
    }
    spinner.stop(`Bundle compatible with ${channel} channel`);
  } else if (!ignoreMetadataCheck) {
    p.log.warn(`Channel ${channel} is new or it's your first upload with compatibility check, it will be ignored this time`);
    localDependencies = await getLocalDepenencies()

    if (autoMinUpdateVersion) {
      minUpdateVersion = bundle
      p.log.info(`Auto set min-update-version to ${minUpdateVersion}`);
    }
  }

  if (updateMetadataRequired && !minUpdateVersion && !ignoreMetadataCheck) {
    p.log.error(`You need to provide a min-update-version to upload a bundle to this channel`);
    program.error('');
  }

  if (minUpdateVersion) {
    if (!regexSemver.test(minUpdateVersion)) {
      p.log.error(`Your minimal version update ${minUpdateVersion}, is not valid it should follow semver convention : https://semver.org/`);
      program.error('');
    }
  }

  const { data: isTrial, error: isTrialsError } = await supabase
    .rpc('is_trial', { userid: userId })
    .single()
  if (isTrial && isTrial > 0 || isTrialsError) {
    p.log.warn(`WARNING !!\nTrial expires in ${isTrial} days`);
    p.log.warn(`Upgrade here: ${localConfig.hostWeb}/dashboard/settings/plans`);
  }

  // check if app already exist
  const { data: appVersion, error: appVersionError } = await supabase
    .rpc('exist_app_versions', { appid, apikey: options.apikey, name_version: bundle })
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
      let keyData = options.keyData || ''
      // check if publicKey exist
      if (!keyData && !existsSync(publicKey)) {
        p.log.error(`Cannot find public key ${publicKey}`);
        if (ciDetect.isCI) {
          program.error('');
        }
        const res = await p.confirm({ message: 'Do you want to use our public key ?' })
        if (!res) {
          p.log.error(`Error: Missing public key`);
          program.error('');
        }
        keyData = localConfig.signKey || ''
      }
      await snag.track({
        channel: 'app',
        event: 'App encryption',
        icon: '🔑',
        user_id: userId,
        tags: {
          'app-id': appid,
        },
        notify: false,
      }).catch()
      // open with fs publicKey path
      if (!keyData) {
        const keyFile = readFileSync(publicKey)
        keyData = keyFile.toString()
      }
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
      await snag.track({
        channel: 'app-error',
        event: 'App Too Large',
        icon: '🚛',
        user_id: userId,
        tags: {
          'app-id': appid,
        },
        notify: false,
      }).catch()
    }
  } else if (external && !external.startsWith('https://')) {
    p.log.error(`External link should should start with "https://" current is "${external}"`);
    program.error('');
  } else {
    await snag.track({
      channel: 'app',
      event: 'App external',
      icon: '📤',
      user_id: userId,
      tags: {
        'app-id': appid,
      },
      notify: false,
    }).catch()
    sessionKey = options.ivSessionKey
  }

  const hashedLocalDependencies = localDependencies ? new Map(localDependencies
    .filter((a) => !!a.native && a.native !== undefined)
    .map((a) => [a.name, a])) : new Map()

  // eslint-disable-next-line max-len
  const nativePackages = (hashedLocalDependencies.size > 0 || !options.ignoreMetadataCheck) ? Array.from(hashedLocalDependencies, ([name, value]) => ({ name, version: value.version })) : undefined

  const versionData = {
    bucket_id: external ? undefined : fileName,
    user_id: userId,
    name: bundle,
    app_id: appid,
    session_key: sessionKey,
    external_url: external,
    storage_provider: external ? 'external' : 'r2-direct',
    minUpdateVersion,
    native_packages: nativePackages,
    checksum,
  }
  const { error: dbError } = await updateOrCreateVersion(supabase, versionData, options.apikey)
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
    const { error: dbError2 } = await updateOrCreateVersion(supabase, versionData, options.apikey)
    if (dbError2) {
      p.log.error(`Cannot update bundle ${formatError(dbError)}`);
      program.error('');
    }
    spinner.stop('Bundle Uploaded 💪')
  }
  const { data: versionId } = await supabase
    .rpc('get_app_versions', { apikey: options.apikey, name_version: bundle, appid })
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
    const bundleUrl = `${localConfig.hostWeb}/app/p/${appidWeb}/channel/${data.id}`
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
  await snag.track({
    channel: 'app',
    event: 'App Uploaded',
    icon: '⏫',
    user_id: userId,
    tags: {
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
    // check if the partial-update flag is set in capacitor.config.json
    if (await isPartialUpdate()) {
      p.log.info(`The partial-update flag was set. Preparing to perform a partial update.`);

      const partialUpdateBaseVersion = await getPartialUpdateBaseVersion()
      if (partialUpdateBaseVersion) {
        await uploadPartialUpdateCommand(appid, options, false)
      }
    }

    // upload the full bundle as usual
    await uploadBundle(appid, options, true)

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
          bucket_id: external ? undefined : safeBundle(baseVersion),
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

        const existingBinaryFiles = await filterBinaryFiles(baseVersionPath);
        console.log('Matching binary files in the base version that will be removed:', existingBinaryFiles);
        if (existingBinaryFiles && existingBinaryFiles.length > 0) {
          removeExistingBinaryFiles(partialVersionPath, existingBinaryFiles)
        }
      }
    } catch (error) {
      let e: Error = error as Error
      p.log.error(`Error: ${JSON.stringify(e.stack)}`);
      program.error('');
    }

    const optionsClone = Object.assign({}, options);
    optionsClone.bundle = `${bundle}-basedon-${baseVersion}`
    optionsClone.path = partialVersionPath
    p.log.info(`CLI options updated for partial-updates: ${JSON.stringify(optionsClone)}`)

    // next, perform the partial update
    await uploadBundle(appid, optionsClone, false)
  } else {
    p.log.error(`Cannot find the path to the full bundle to be partially updated. Did you delete it?`);
    program.error('');
  }
}