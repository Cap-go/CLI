import type { Buffer } from 'node:buffer'
import type { CapacitorConfig } from '../config'
import type { Database } from '../types/supabase.types'
import type { manifestType, OptionsBase } from '../utils'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { exit } from 'node:process'
import { S3Client } from '@bradenmacdonald/s3-lite-client'
import { intro, log, outro, spinner as spinnerC } from '@clack/prompts'
import { checksum as getChecksum } from '@tomasklaen/checksum'
import { program } from 'commander'
import ky, { HTTPError } from 'ky'
import pack from '../../package.json'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { encryptSource } from '../api/crypto'
import { encryptChecksumV2, encryptSourceV2 } from '../api/cryptoV2'
import { checkAlerts } from '../api/update'
import { ALERT_MB, baseKeyPub, baseKeyV2, checkChecksum, checkCompatibility, checkPlanValid, convertAppName, createSupabaseClient, deletedFailedVersion, findSavedKey, formatError, getAppId, getConfig, getLocalConfig, getLocalDepenencies, getOrganizationId, getPMAndCommand, getRemoteFileConfig, hasOrganizationPerm, MAX_CHUNK_SIZE, OrganizationPerm, readPackageJson, regexSemver, sendEvent, updateConfig, updateOrCreateChannel, updateOrCreateVersion, UPLOAD_TIMEOUT, uploadTUS, uploadUrl, verifyUser, zipFile } from '../utils'
import { checkIndexPosition, searchInDirectory } from './check'
import { prepareBundlePartialFiles, uploadPartial } from './partial'

interface Options extends OptionsBase {
  bundle?: string
  path?: string
  channel?: string
  displayIvSession?: boolean
  external?: string
  key?: boolean | string
  keyV2?: boolean | string
  keyData?: string
  keyDataV2?: string
  ivSessionKey?: string
  s3Region?: string
  s3Apikey?: string
  s3Apisecret?: string
  s3BucketName?: string
  s3Port?: number
  s3SSL?: boolean
  s3Endpoint?: string
  bundleUrl?: boolean
  codeCheck?: boolean
  oldEncryption?: boolean
  minUpdateVersion?: string
  autoMinUpdateVersion?: boolean
  autoSetBundle?: boolean
  ignoreMetadataCheck?: boolean
  ignoreChecksumCheck?: boolean
  timeout?: number
  multipart?: boolean
  partial?: boolean
  partialOnly?: boolean
  tus?: boolean
  encryptedChecksum?: string
  packageJson?: string
  dryUpload?: boolean
  nodeModules?: string
  tusChunkSize?: number
}

type SupabaseType = Awaited<ReturnType<typeof createSupabaseClient>>
type pmType = ReturnType<typeof getPMAndCommand>
type localConfigType = Awaited<ReturnType<typeof getLocalConfig>>

async function getBundle(config: CapacitorConfig, options: Options) {
  const pkg = await readPackageJson('', options.packageJson)
  // create bundle name format : 1.0.0-beta.x where x is a uuid
  const bundle = options.bundle
    || config?.plugins?.CapacitorUpdater?.version
    || pkg?.version
    || `0.0.1-beta.${randomUUID().split('-')[0]}`

  if (!regexSemver.test(bundle)) {
    log.error(`Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`)
    program.error('')
  }

  return bundle
}

function getApikey(options: Options) {
  const apikey = options.apikey || findSavedKey()
  if (!apikey) {
    log.error(`Missing API key, you need to provide a API key to upload your bundle`)
    program.error('')
  }

  return apikey
}

function getAppIdAndPath(appId: string | undefined, options: Options, config: CapacitorConfig) {
  const finalAppId = getAppId(appId, config)
  const path = options.path || config?.webDir

  if (!finalAppId) {
    log.error('Missing argument, you need to provide a appid or be in a capacitor project')
    program.error('')
  }
  if (!path) {
    log.error('Missing argument, you need to provide a path (--path), or be in a capacitor project')
    program.error('')
  }

  if (!existsSync(path)) {
    log.error(`Path ${path} does not exist, build your app first, or provide a valid path`)
    program.error('')
  }

  return { appid: finalAppId, path }
}

function checkNotifyAppReady(options: Options, path: string) {
  const checkNotifyAppReady = options.codeCheck

  if (typeof checkNotifyAppReady === 'undefined' || checkNotifyAppReady) {
    const isPluginConfigured = searchInDirectory(path, 'notifyAppReady')
    if (!isPluginConfigured) {
      log.error(`notifyAppReady() is missing in the source code. see: https://capgo.app/docs/plugin/api/#notifyappready`)
      program.error('')
    }
    const foundIndex = checkIndexPosition(path)
    if (!foundIndex) {
      log.error(`index.html is missing in the root folder of ${path}`)
      program.error('')
    }
  }
}

async function verifyCompatibility(supabase: SupabaseType, pm: pmType, options: Options, channel: string, appid: string, bundle: string) {
  // Check compatibility here
  const ignoreMetadataCheck = options.ignoreMetadataCheck
  const autoMinUpdateVersion = options.autoMinUpdateVersion
  let minUpdateVersion = options.minUpdateVersion

  const { data: channelData, error: channelError } = await supabase
    .from('channels')
    .select('disable_auto_update, version ( min_update_version, native_packages )')
    .eq('name', channel)
    .eq('app_id', appid)
    .single()

  const updateMetadataRequired = !!channelData && channelData.disable_auto_update === 'version_number'

  // eslint-disable-next-line no-undef-init
  let localDependencies: Awaited<ReturnType<typeof getLocalDepenencies>> | undefined = undefined
  let finalCompatibility: Awaited<ReturnType<typeof checkCompatibility>>['finalCompatibility']

  // We only check compatibility IF the channel exists
  if (!channelError && channelData && channelData.version && (channelData.version as any).native_packages && !ignoreMetadataCheck) {
    const spinner = spinnerC()
    spinner.start(`Checking bundle compatibility with channel ${channel}`)
    const {
      finalCompatibility: finalCompatibilityWithChannel,
      localDependencies: localDependenciesWithChannel,
    } = await checkCompatibility(supabase, appid, channel, options.packageJson, options.nodeModules)

    finalCompatibility = finalCompatibilityWithChannel
    localDependencies = localDependenciesWithChannel

    if (finalCompatibility.find(x => x.localVersion !== x.remoteVersion)) {
      spinner.stop(`Bundle NOT compatible with ${channel} channel`)
      log.warn(`You can check compatibility with "${pm.runner} @capgo/cli bundle compatibility"`)

      if (autoMinUpdateVersion) {
        minUpdateVersion = bundle
        log.info(`Auto set min-update-version to ${minUpdateVersion}`)
      }
    }
    else if (autoMinUpdateVersion) {
      try {
        const { min_update_version: lastMinUpdateVersion } = channelData.version as any
        if (!lastMinUpdateVersion || !regexSemver.test(lastMinUpdateVersion)) {
          log.error('Invalid remote min update version, skipping auto setting compatibility')
          program.error('')
        }

        minUpdateVersion = lastMinUpdateVersion
        spinner.stop(`Auto set min-update-version to ${minUpdateVersion}`)
      }
      catch {
        log.error(`Cannot auto set compatibility, invalid data ${channelData}`)
        program.error('')
      }
    }
    else {
      spinner.stop(`Bundle compatible with ${channel} channel`)
    }
  }
  else if (!ignoreMetadataCheck) {
    log.warn(`Channel ${channel} is new or it's your first upload with compatibility check, it will be ignored this time`)
    localDependencies = await getLocalDepenencies(options.packageJson, options.nodeModules)

    if (autoMinUpdateVersion) {
      minUpdateVersion = bundle
      log.info(`Auto set min-update-version to ${minUpdateVersion}`)
    }
  }

  if (updateMetadataRequired && !minUpdateVersion && !ignoreMetadataCheck) {
    log.error(`You need to provide a min-update-version to upload a bundle to this channel`)
    program.error('')
  }

  if (minUpdateVersion) {
    if (!regexSemver.test(minUpdateVersion)) {
      log.error(`Your minimal version update ${minUpdateVersion}, is not valid it should follow semver convention : https://semver.org/`)
      program.error('')
    }
  }

  const hashedLocalDependencies = localDependencies
    ? new Map(localDependencies
      .filter(a => !!a.native && a.native !== undefined)
      .map(a => [a.name, a]))
    : new Map()

  const nativePackages = (hashedLocalDependencies.size > 0 || !options.ignoreMetadataCheck) ? Array.from(hashedLocalDependencies, ([name, value]) => ({ name, version: value.version })) : undefined

  return { nativePackages, minUpdateVersion }
}

async function checkTrial(supabase: SupabaseType, orgId: string, localConfig: localConfigType) {
  const { data: isTrial, error: isTrialsError } = await supabase
    .rpc('is_trial_org', { orgid: orgId })
    .single()
  if ((isTrial && isTrial > 0) || isTrialsError) {
  // TODO: Come back to this to fix for orgs v3
    log.warn(`WARNING !!\nTrial expires in ${isTrial} days`)
    log.warn(`Upgrade here: ${localConfig.hostWeb}/dashboard/settings/plans?oid=${orgId}`)
  }
}

async function checkVersionExists(supabase: SupabaseType, appid: string, bundle: string) {
  // check if app already exist
  // apikey is sooo legacy code, current prod does not use it
  // TODO: remove apikey and create a new function who not need it
  const { data: appVersion, error: appVersionError } = await supabase
    .rpc('exist_app_versions', { appid, apikey: '', name_version: bundle })
    .single()

  if (appVersion || appVersionError) {
    log.error(`Version ${bundle} already exists ${formatError(appVersionError)}`)
    program.error('')
  }
}

async function prepareBundleFile(path: string, options: Options, localConfig: localConfigType, apikey: string, orgId: string, appid: string) {
  let sessionKey
  let checksum = ''
  let zipped: Buffer | null = null
  const key = options.key
  const keyV2 = options.keyV2

  zipped = await zipFile(path)
  const s = spinnerC()
  s.start(`Calculating checksum`)
  if ((keyV2 || options.keyDataV2 || existsSync(baseKeyV2)) && key !== false) {
    checksum = await getChecksum(zipped, 'sha256')
  }
  else {
    checksum = await getChecksum(zipped, 'crc32')
  }
  s.stop(`Checksum: ${checksum}`)
  // key should be undefined or a string if false it should ingore encryption DO NOT REPLACE key === false With !key it will not work
  if (key === false) {
    log.info(`Encryption ignored`)
  }
  else if ((keyV2 || existsSync(baseKeyV2) || options.keyDataV2) && !options.oldEncryption) {
    const privateKey = typeof keyV2 === 'string' ? keyV2 : baseKeyV2
    let keyDataV2 = options.keyDataV2 || ''
    // check if publicKey exist
    if (!keyDataV2 && !existsSync(privateKey)) {
      log.error(`Cannot find private key ${privateKey}`)
      program.error('')
    }
    await sendEvent(apikey, {
      channel: 'app',
      event: 'App encryption v2',
      icon: '🔑',
      user_id: orgId,
      tags: {
        'app-id': appid,
      },
      notify: false,
    })
    // open with fs publicKey path
    if (!keyDataV2) {
      const keyFile = readFileSync(privateKey)
      keyDataV2 = keyFile.toString()
    }
    // encrypt
    log.info(`Encrypting your bundle with V2`)
    const res = encryptSourceV2(zipped, keyDataV2)
    checksum = encryptChecksumV2(checksum, keyDataV2)
    sessionKey = res.ivSessionKey
    if (options.displayIvSession) {
      log.info(`Your Iv Session key is ${sessionKey},
    keep it safe, you will need it to decrypt your bundle.
    It will be also visible in your dashboard\n`)
    }
    zipped = res.encryptedData
  }
  else if (key || options.keyData || existsSync(baseKeyPub)) {
    log.warn(`WARNING !!\nYou are using old encryption key, it's not secure enouth and it should be migrate on v2, here is the migration guide: https://capgo.app/docs/cli/migrations/encryption/`)
    const publicKey = typeof key === 'string' ? key : baseKeyPub
    let keyData = options.keyData || ''
    // check if publicKey exist
    if (!keyData && !existsSync(publicKey)) {
      log.error(`Cannot find public key ${publicKey}`)
      program.error('')
    }
    await sendEvent(apikey, {
      channel: 'app',
      event: 'App encryption',
      icon: '🔑',
      user_id: orgId,
      tags: {
        'app-id': appid,
      },
      notify: false,
    })
    // open with fs publicKey path
    if (!keyData) {
      const keyFile = readFileSync(publicKey)
      keyData = keyFile.toString()
    }
    // encrypt
    log.info(`Encrypting your bundle`)
    const res = encryptSource(zipped, keyData)
    sessionKey = res.ivSessionKey
    if (options.displayIvSession) {
      log.info(`Your Iv Session key is ${sessionKey},
keep it safe, you will need it to decrypt your bundle.
It will be also visible in your dashboard\n`)
    }
    zipped = res.encryptedData
  }
  const mbSize = Math.floor((zipped?.byteLength ?? 0) / 1024 / 1024)
  if (mbSize > ALERT_MB) {
    log.warn(`WARNING !!\nThe app size is ${mbSize} Mb, this may take a while to download for users\n`)
    log.info(`Learn how to optimize your assets https://capgo.app/blog/optimise-your-images-for-updates/\n`)
    await sendEvent(apikey, {
      channel: 'app-error',
      event: 'App Too Large',
      icon: '🚛',
      user_id: orgId,
      tags: {
        'app-id': appid,
      },
      notify: false,
    })
  }

  return { zipped, sessionKey, checksum }
}

async function uploadBundleToCapgoCloud(apikey: string, supabase: SupabaseType, appid: string, bundle: string, orgId: string, zipped: Buffer, options: Options) {
  const spinner = spinnerC()
  spinner.start(`Uploading Bundle`)
  const startTime = performance.now()
  let isTus = false
  if (options.dryUpload) {
    spinner.stop(`Dry run, bundle not uploaded\nBundle uploaded 💪 in 0 seconds`)
    return
  }
  try {
    const localConfig = await getLocalConfig()
    if ((options.multipart !== undefined && options.multipart) || (options.tus !== undefined && options.tus)) {
      if (options.multipart) {
        log.info(`Uploading bundle with multipart is deprecated, we upload with TUS instead`)
      }
      else {
        log.info(`Uploading bundle with TUS protocol`)
      }
      await uploadTUS(apikey, zipped, orgId, appid, bundle, spinner, localConfig, options.tusChunkSize)
      isTus = true
      const filePath = `orgs/${orgId}/apps/${appid}/${bundle}.zip`
      const { error: changeError } = await supabase
        .from('app_versions')
        .update({ r2_path: filePath })
        .eq('name', bundle)
        .eq('app_id', appid)
      if (changeError) {
        log.error(`Cannot finish TUS upload ${formatError(changeError)}`)
        Promise.reject(new Error('Cannot finish TUS upload'))
      }
    }
    else {
      const url = await uploadUrl(supabase, appid, bundle)
      if (!url) {
        log.error(`Cannot get upload url`)
        Promise.reject(new Error('Cannot get upload url'))
      }
      await ky.put(url, {
        timeout: options.timeout || UPLOAD_TIMEOUT,
        retry: 5,
        body: zipped,
      })
    }
  }
  catch (errorUpload) {
    const endTime = performance.now()
    const uploadTime = ((endTime - startTime) / 1000).toFixed(2)
    spinner.stop(`Failed to upload bundle ( after ${uploadTime} seconds)`)
    if (errorUpload instanceof HTTPError) {
      const body = await errorUpload.response.json<{ error?: string, status?: string, message?: string }>()
      log.error(`Response Error: ${body.error || body.status || body.message}`)
    }
    else {
      if (!options.tus) {
        log.error(`Cannot upload bundle ( try again with --tus option) ${formatError(errorUpload)}`)
      }
      else {
        log.error(`Cannot upload bundle please contact support if the issue persists ${formatError(errorUpload)}`)
      }
    }
    // call delete version on path /delete_failed_version to delete the version
    await deletedFailedVersion(supabase, appid, bundle)
    program.error('')
  }

  const endTime = performance.now()
  const uploadTime = ((endTime - startTime) / 1000).toFixed(2)
  spinner.stop(`Bundle uploaded 💪 in (${uploadTime} seconds)`)
  await sendEvent(apikey, {
    channel: 'performance',
    event: isTus ? 'TUS upload zip performance' : 'Upload zip performance',
    icon: '🚄',
    user_id: orgId,
    tags: {
      'app-id': appid,
      'time': uploadTime,
    },
    notify: false,
  })
}

async function setVersionInChannel(
  supabase: SupabaseType,
  apikey: string,
  displayBundleUrl: boolean,
  bundle: string,
  channel: string,
  userId: string,
  orgId: string,
  appid: string,
  localConfig: localConfigType,
) {
  const { data: versionId } = await supabase
    .rpc('get_app_versions', { apikey, name_version: bundle, appid })
    .single()

  if (!versionId) {
    log.warn('Cannot get version id, cannot set channel')
    program.error('')
  }
  const { error: dbError3, data } = await updateOrCreateChannel(supabase, {
    name: channel,
    app_id: appid,
    created_by: userId,
    version: versionId,
    owner_org: orgId,
  })
  if (dbError3) {
    log.error(`Cannot set channel, the upload key is not allowed to do that, use the "all" for this. ${formatError(dbError3)}`)
    program.error('')
  }
  const appidWeb = convertAppName(appid)
  const bundleUrl = `${localConfig.hostWeb}/app/p/${appidWeb}/channel/${data.id}`
  if (data?.public)
    log.info('Your update is now available in your public channel 🎉')
  else if (data?.id)
    log.info(`Link device to this bundle to try it: ${bundleUrl}`)

  if (displayBundleUrl) {
    log.info(`Bundle url: ${bundleUrl}`)
  }
  else if (!versionId) {
    log.warn('Cannot set bundle with upload key, use key with more rights for that')
    program.error('')
  }
}

export async function getDefaulUploadChannel(appId: string, supabase: SupabaseType, hostWeb: string) {
  const { error, data } = await supabase.from('apps')
    .select('default_upload_channel')
    .single()

  if (error) {
    log.warn('Cannot find default upload channel')
    const appIdUrl = convertAppName(appId)
    log.info(`You can set it here:  ${hostWeb}/app/p/${appIdUrl}/settings`)
    return null
  }

  return data.default_upload_channel
}

export async function uploadBundle(preAppid: string, options: Options, shouldExit = true) {
  intro(`Uploading with CLI version ${pack.version}`)
  const pm = getPMAndCommand()
  await checkAlerts()

  const { s3Region, s3Apikey, s3Apisecret, s3BucketName, s3Endpoint, s3Port, s3SSL } = options

  const apikey = getApikey(options)
  const extConfig = await getConfig()
  const fileConfig = await getRemoteFileConfig()
  const { appid, path } = getAppIdAndPath(preAppid, options, extConfig.config)
  const bundle = await getBundle(extConfig.config, options)

  if (options.autoSetBundle) {
    await updateConfig({ version: bundle })
  }

  checkNotifyAppReady(options, path)

  log.info(`Upload ${appid}@${bundle} started from path "${path}" to Capgo cloud`)

  const localConfig = await getLocalConfig()
  const supabase = await createSupabaseClient(apikey)
  const userId = await verifyUser(supabase, apikey, ['write', 'all', 'upload'])
  const channel = options.channel || await getDefaulUploadChannel(appid, supabase, localConfig.hostWeb) || 'dev'

  // Now if it does exist we will fetch the org id
  const orgId = await getOrganizationId(supabase, appid)
  await checkPlanValid(supabase, orgId, apikey, appid, true)
  await checkTrial(supabase, orgId, localConfig)

  const { nativePackages, minUpdateVersion } = await verifyCompatibility(supabase, pm, options, channel, appid, bundle)
  await checkVersionExists(supabase, appid, bundle)

  if (options.external && !options.external.startsWith('https://')) {
    log.error(`External link should should start with "https://" current is "${options.external}"`)
    program.error('')
  }

  const versionData = {
    name: bundle,
    app_id: appid,
    session_key: undefined as undefined | string,
    external_url: options.external,
    storage_provider: options.external ? 'external' : 'r2-direct',
    min_update_version: minUpdateVersion,
    native_packages: nativePackages,
    owner_org: orgId,
    user_id: userId,
    checksum: undefined as undefined | string,
  } as Database['public']['Tables']['app_versions']['Insert']

  let zipped: Buffer | null = null
  if (!options.external) {
    const { zipped: _zipped, sessionKey, checksum } = await prepareBundleFile(path, options, localConfig, apikey, orgId, appid)
    versionData.session_key = sessionKey
    versionData.checksum = checksum
    zipped = _zipped
    if (!options.ignoreChecksumCheck) {
      await checkChecksum(supabase, appid, channel, checksum)
    }
  }
  else {
    await sendEvent(apikey, {
      channel: 'app',
      event: 'App external',
      icon: '📤',
      user_id: orgId,
      tags: {
        'app-id': appid,
      },
      notify: false,
    })
    versionData.session_key = options.ivSessionKey
    versionData.checksum = options.encryptedChecksum
  }

  // ALLOW TO OVERRIDE THE FILE CONFIG WITH THE OPTIONS IF THE FILE CONFIG IS FORCED
  if (!fileConfig.TUSUpload || options.external) {
    options.tus = false
  }
  else {
    options.tus = options.tus || fileConfig.TUSUploadForced
  }
  // Temporary disable partial upload on windows TODO: fix this
  // if (!fileConfig.partialUpload || options.external || osPlatform() === 'win32') {
  if (!fileConfig.partialUpload || options.external) {
    options.partial = false
  }
  else {
    options.partial = options.partial || options.partialOnly || fileConfig.partialUploadForced
  }

  const manifest: manifestType = options.partial ? await prepareBundlePartialFiles(path, apikey, orgId, appid) : []

  const { error: dbError } = await updateOrCreateVersion(supabase, versionData)
  if (dbError) {
    log.error(`Cannot add bundle ${formatError(dbError)}`)
    program.error('')
  }
  if (options.tusChunkSize && options.tusChunkSize > MAX_CHUNK_SIZE) {
    log.error(`Chunk size ${options.tusChunkSize} is greater than the maximum chunk size ${MAX_CHUNK_SIZE}, using the maximum chunk size`)
    options.tusChunkSize = MAX_CHUNK_SIZE
  }

  if (zipped && (s3BucketName || s3Endpoint || s3Region || s3Apikey || s3Apisecret || s3Port || s3SSL)) {
    if (!s3BucketName || !s3Endpoint || !s3Region || !s3Apikey || !s3Apisecret || !s3Port) {
      log.error('Missing argument, for S3 upload you need to provide a bucket name, endpoint, region, port, API key, and API secret')
      program.error('')
    }

    log.info('Uploading to S3')
    const s3Client = new S3Client({
      endPoint: s3Endpoint,
      region: s3Region,
      port: s3Port,
      useSSL: s3SSL,
      bucket: s3BucketName,
      accessKey: s3Apikey,
      secretKey: s3Apisecret,
    })
    const fileName = `${appid}-${bundle}`
    const encodeFileName = encodeURIComponent(fileName)
    await s3Client.putObject(fileName, Uint8Array.from(zipped))
    versionData.external_url = `https://${s3Endpoint}/${encodeFileName}`
    versionData.storage_provider = 'external'
  }
  else if (zipped) {
    if (!options.partialOnly) {
      await uploadBundleToCapgoCloud(apikey, supabase, appid, bundle, orgId, zipped, options)
    }

    let finalManifest: Awaited<ReturnType<typeof uploadPartial>> | null = null
    try {
      if (options.dryUpload) {
        options.partial = false
      }
      finalManifest = options.partial ? await uploadPartial(apikey, manifest, path, appid, bundle, orgId, options.tusChunkSize) : null
    }
    catch (err) {
      log.info(`Failed to upload partial files to capgo cloud. Error: ${formatError(err)}. This is not a critical error, the bundle has been uploaded without the partial files`)
    }

    versionData.storage_provider = 'r2'
    versionData.manifest = finalManifest
    const { error: dbError2 } = await updateOrCreateVersion(supabase, versionData)
    if (dbError2) {
      log.error(`Cannot update bundle ${formatError(dbError2)}`)
      program.error('')
    }
  }

  // Check we have app access to this appId
  const permissions = await checkAppExistsAndHasPermissionOrgErr(supabase, apikey, appid, OrganizationPerm.upload)

  if (hasOrganizationPerm(permissions, OrganizationPerm.write)) {
    await setVersionInChannel(supabase, apikey, !!options.bundleUrl, bundle, channel, userId, orgId, appid, localConfig)
  }
  else {
    log.warn('Cannot set channel as a upload organization member')
  }

  await sendEvent(apikey, {
    channel: 'app',
    event: 'App Uploaded',
    icon: '⏫',
    user_id: orgId,
    tags: {
      'app-id': appid,
    },
    notify: false,
  })
  if (shouldExit) {
    outro('Time to share your update to the world 🌍')
    exit()
  }
  return true
}

function checkValidOptions(options: Options) {
  if (options.ivSessionKey && !options.external) {
    log.error('You need to provide an external url if you want to use the --iv-session-key option')
    program.error('')
  }
  if (options.encryptedChecksum && !options.external) {
    log.error('You need to provide an external url if you want to use the --encrypted-checksum option')
    program.error('')
  }
  if (options.partial && options.external) {
    log.error('You cannot use the --partial option with an external url')
    program.error('')
  }
  if (options.tus && options.external) {
    log.error('You cannot use the --tus option with an external url')
    program.error('')
  }
  if (options.dryUpload && options.external) {
    log.error('You cannot use the --dry-upload option with an external url')
    program.error('')
  }
  if (options.multipart && options.external) {
    log.error('You cannot use the --multipart option with an external url')
    program.error('')
  }
  // cannot set key if external
  if (options.external && (options.key || options.keyData || options.keyV2 || options.keyDataV2)) {
    log.error('You cannot set a key if you are uploading to an external url')
    program.error('')
  }
  // cannot set key and key-v2
  if ((options.key || options.keyData) && (options.keyV2 || options.keyDataV2)) {
    log.error('You cannot set both key and key-v2')
    program.error('')
  }
  // cannot set key and key-data
  if (options.key && options.keyData) {
    log.error('You cannot set both key and key-data')
    program.error('')
  }
  // cannot set key-v2 and key-data-v2
  if (options.keyV2 && options.keyDataV2) {
    log.error('You cannot set both key-v2 and key-data-v2')
    program.error('')
  }
  // cannot set s3 and external
  if (options.external && (options.s3Region || options.s3Apikey || options.s3Apisecret || options.s3Endpoint || options.s3BucketName || options.s3Port || options.s3SSL)) {
    log.error('You cannot set S3 options if you are uploading to an external url, it\'s automatically handled')
    program.error('')
  }
  // cannot set --encrypted-checksum if not external
  if (options.encryptedChecksum && !options.external) {
    log.error('You cannot set the --encrypted-checksum option if you are not uploading to an external url')
    program.error('')
  }
  // cannot set min-update-version and auto-min-update-version
  if (options.minUpdateVersion && options.autoMinUpdateVersion) {
    log.error('You cannot set both min-update-version and auto-min-update-version, use only one of them')
    program.error('')
  }
}

export async function uploadCommand(appid: string, options: Options) {
  try {
    checkValidOptions(options)
    await uploadBundle(appid, options, true)
  }
  catch (error) {
    log.error(formatError(error))
    program.error('')
  }
}

export async function uploadDeprecatedCommand(appid: string, options: Options) {
  const pm = getPMAndCommand()
  log.warn(`⚠️  This command is deprecated, use "${pm.runner} @capgo/cli bundle upload" instead ⚠️`)
  try {
    checkValidOptions(options)
    await uploadBundle(appid, options, true)
  }
  catch (error) {
    log.error(formatError(error))
    program.error('')
  }
}
