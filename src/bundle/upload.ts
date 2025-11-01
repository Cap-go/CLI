import type { Buffer } from 'node:buffer'
import type { CapacitorConfig } from '../config'
import type { Database } from '../types/supabase.types'
import type { manifestType } from '../utils'
import type { OptionsUpload } from './upload_interface'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path/posix'
import { cwd } from 'node:process'
import { S3Client } from '@bradenmacdonald/s3-lite-client'
import { intro, log, outro, spinner as spinnerC } from '@clack/prompts'
import { checksum as getChecksum } from '@tomasklaen/checksum'
import ky, { HTTPError } from 'ky'
import coerceVersion from 'semver/functions/coerce'
// We only use semver from std for Capgo semver, others connected to package.json need npm one as it's not following the semver spec
import semverGte from 'semver/functions/gte'
import pack from '../../package.json'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { encryptChecksumV2, encryptSourceV2, generateSessionKey } from '../api/cryptoV2'
import { checkAlerts } from '../api/update'
import { baseKeyV2, checkChecksum, checkCompatibility, checkPlanValidUpload, checkRemoteCliMessages, createSupabaseClient, deletedFailedVersion, findRoot, findSavedKey, formatError, getAllPackagesDependencies, getAppId, getBundleVersion, getConfig, getLocalConfig, getLocalDepenencies, getOrganizationId, getPMAndCommand, getRemoteFileConfig, hasOrganizationPerm, isCompatible, OrganizationPerm, PACKNAME, regexSemver, sendEvent, updateConfigUpdater, updateOrCreateChannel, updateOrCreateVersion, UPLOAD_TIMEOUT, uploadTUS, uploadUrl, verifyUser, zipFile } from '../utils'
import { checkIndexPosition, searchInDirectory } from './check'
import { prepareBundlePartialFiles, uploadPartial } from './partial'

type SupabaseType = Awaited<ReturnType<typeof createSupabaseClient>>
type pmType = ReturnType<typeof getPMAndCommand>
type localConfigType = Awaited<ReturnType<typeof getLocalConfig>>

export interface UploadBundleResult {
  success: boolean
  bundle: string
  checksum?: string | null
  encryptionMethod: 'none' | 'v1' | 'v2'
  sessionKey?: string
  ivSessionKey?: string | null
  storageProvider?: string
  skipped?: boolean
  reason?: string
}

function uploadFail(message: string): never {
  log.error(message)
  throw new Error(message)
}

async function getBundle(config: CapacitorConfig, options: OptionsUpload) {
  const pkgVersion = getBundleVersion('', options.packageJson)
  // create bundle name format : 1.0.0-beta.x where x is a uuid
  const bundle = options.bundle
    || config?.plugins?.CapacitorUpdater?.version
    || pkgVersion
    || `0.0.1-beta.${randomUUID().split('-')[0]}`

  if (!regexSemver.test(bundle)) {
    uploadFail(`Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`)
  }

  return bundle
}

function getApikey(options: OptionsUpload) {
  const apikey = options.apikey || findSavedKey()
  if (!apikey) {
    uploadFail('Missing API key, you need to provide an API key to upload your bundle')
  }

  return apikey
}

function getAppIdAndPath(appId: string | undefined, options: OptionsUpload, config: CapacitorConfig) {
  const finalAppId = getAppId(appId, config)
  const path = options.path || config?.webDir

  if (!finalAppId) {
    uploadFail('Missing argument, you need to provide a appid or be in a capacitor project')
  }
  if (!path) {
    uploadFail('Missing argument, you need to provide a path (--path), or be in a capacitor project')
  }

  if (!existsSync(path)) {
    uploadFail(`Path ${path} does not exist, build your app first, or provide a valid path`)
  }

  return { appid: finalAppId, path }
}

function checkNotifyAppReady(options: OptionsUpload, path: string) {
  const checkNotifyAppReady = options.codeCheck

  if (typeof checkNotifyAppReady === 'undefined' || checkNotifyAppReady) {
    const isPluginConfigured = searchInDirectory(path, 'notifyAppReady')
    if (!isPluginConfigured) {
      uploadFail(`notifyAppReady() is missing in the build folder of your app. see: https://capgo.app/docs/plugin/api/#notifyappready
      If you are sure your app has this code, you can use the --no-code-check option`)
    }
    const foundIndex = checkIndexPosition(path)
    if (!foundIndex) {
      uploadFail(`index.html is missing in the root folder of ${path}`)
    }
  }
}

async function verifyCompatibility(supabase: SupabaseType, pm: pmType, options: OptionsUpload, channel: string, appid: string, bundle: string) {
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

  let localDependencies: Awaited<ReturnType<typeof getLocalDepenencies>> | undefined
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

    // Check if any package is incompatible
    if (finalCompatibility.find(x => !isCompatible(x))) {
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
        if (!lastMinUpdateVersion || !regexSemver.test(lastMinUpdateVersion))
          uploadFail('Invalid remote min update version, skipping auto setting compatibility')

        minUpdateVersion = lastMinUpdateVersion
        spinner.stop(`Auto set min-update-version to ${minUpdateVersion}`)
      }
      catch {
        uploadFail(`Cannot auto set compatibility, invalid data ${channelData}`)
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
    uploadFail('You need to provide a min-update-version to upload a bundle to this channel')
  }

  if (minUpdateVersion) {
    if (!regexSemver.test(minUpdateVersion))
      uploadFail(`Your minimal version update ${minUpdateVersion}, is not valid it should follow semver convention : https://semver.org/`)
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

async function checkVersionExists(supabase: SupabaseType, appid: string, bundle: string, versionExistsOk = false): Promise<boolean> {
  // check if app already exist
  // apikey is sooo legacy code, current prod does not use it
  // TODO: remove apikey and create a new function who not need it
  const { data: appVersion, error: appVersionError } = await supabase
    .rpc('exist_app_versions', { appid, apikey: '', name_version: bundle })
    .single()

  if (appVersion || appVersionError) {
    if (versionExistsOk) {
      log.warn(`Version ${bundle} already exists - exiting gracefully due to --silent-fail option`)
      outro('Bundle version already exists - exiting gracefully 🎉')
      return true
    }
    uploadFail(`Version ${bundle} already exists ${formatError(appVersionError)}`)
  }

  return false
}

async function prepareBundleFile(path: string, options: OptionsUpload, apikey: string, orgId: string, appid: string, maxUploadLength: number, alertUploadSize: number) {
  let ivSessionKey
  let sessionKey
  let checksum = ''
  let zipped: Buffer | null = null
  let encryptionMethod = 'none' as 'none' | 'v2' | 'v1'
  let finalKeyData = ''
  const keyV2 = options.keyV2
  const noKey = options.key === false

  zipped = await zipFile(path)
  const s = spinnerC()
  s.start(`Calculating checksum`)
  const root = join(findRoot(cwd()), PACKNAME)
  // options.packageJson
  const dependencies = await getAllPackagesDependencies(undefined, options.packageJson || root)
  const updaterVersion = dependencies.get('@capgo/capacitor-updater')
  let isv7 = false
  const coerced = coerceVersion(updaterVersion)
  if (!updaterVersion) {
    uploadFail('Cannot find @capgo/capacitor-updater in ./package.json, provide the package.json path with --package-json it\'s required for v7 CLI to work')
  }
  else if (coerced) {
    isv7 = semverGte(coerced.version, '7.0.0')
  }
  else if (updaterVersion === 'link:@capgo/capacitor-updater') {
    log.warn('Using local @capgo/capacitor-updater. Assuming v7')
    isv7 = true
  }
  if (((keyV2 || options.keyDataV2 || existsSync(baseKeyV2)) && !noKey) || isv7) {
    checksum = await getChecksum(zipped, 'sha256')
  }
  else {
    checksum = await getChecksum(zipped, 'crc32')
  }
  s.stop(`Checksum: ${checksum}`)
  // key should be undefined or a string if false it should ingore encryption DO NOT REPLACE key === false With !key it will not work
  if (noKey) {
    log.info(`Encryption ignored`)
  }
  else if ((keyV2 || existsSync(baseKeyV2) || options.keyDataV2) && !options.oldEncryption) {
    const privateKey = typeof keyV2 === 'string' ? keyV2 : baseKeyV2
    let keyDataV2 = options.keyDataV2 || ''
    if (!keyDataV2 && !existsSync(privateKey))
      uploadFail(`Cannot find private key ${privateKey}`)
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
    if (!keyDataV2) {
      const keyFile = readFileSync(privateKey)
      keyDataV2 = keyFile.toString()
    }
    log.info('Encrypting your bundle with V2')
    const { sessionKey: sKey, ivSessionKey: ivKey } = generateSessionKey(keyDataV2)
    const encryptedData = encryptSourceV2(zipped, sKey, ivKey)
    checksum = encryptChecksumV2(checksum, keyDataV2)
    ivSessionKey = ivKey
    sessionKey = sKey
    encryptionMethod = 'v2'
    finalKeyData = keyDataV2
    if (options.displayIvSession) {
      log.info(`Your Iv Session key is ${ivSessionKey},
    keep it safe, you will need it to decrypt your bundle.
    It will be also visible in your dashboard\n`)
    }
    zipped = encryptedData
  }
  const mbSize = Math.floor((zipped?.byteLength ?? 0) / 1024 / 1024)
  const mbSizeMax = Math.floor(maxUploadLength / 1024 / 1024)
  if (zipped?.byteLength > maxUploadLength) {
    uploadFail(`The bundle size is ${mbSize} Mb, this is greater than the maximum upload length ${mbSizeMax} Mb, please reduce the size of your bundle`)
  }
  else if (zipped?.byteLength > alertUploadSize) {
    log.warn(`WARNING !!\nThe bundle size is ${mbSize} Mb, this may take a while to download for users\n`)
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

  return { zipped, ivSessionKey, sessionKey, checksum, encryptionMethod, finalKeyData }
}

async function uploadBundleToCapgoCloud(apikey: string, supabase: SupabaseType, appid: string, bundle: string, orgId: string, zipped: Buffer, options: OptionsUpload, tusChunkSize: number) {
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
      await uploadTUS(apikey, zipped, orgId, appid, bundle, spinner, localConfig, tusChunkSize)
      isTus = true
      const filePath = `orgs/${orgId}/apps/${appid}/${bundle}.zip`
      const { error: changeError } = await supabase
        .from('app_versions')
        .update({ r2_path: filePath })
        .eq('name', bundle)
        .eq('app_id', appid)
      if (changeError) {
        log.error(`Cannot finish TUS upload ${formatError(changeError)}`)
        return Promise.reject(new Error('Cannot finish TUS upload'))
      }
    }
    else {
      const url = await uploadUrl(supabase, appid, bundle)
      if (!url) {
        log.error(`Cannot get upload url`)
        return Promise.reject(new Error('Cannot get upload url'))
      }
      await ky.put(url, {
        timeout: options.timeout || UPLOAD_TIMEOUT,
        retry: 5,
        body: zipped,
        headers: {
          'Content-Type': 'application/zip',
        },
      })
    }
  }
  catch (errorUpload) {
    const endTime = performance.now()
    const uploadTime = ((endTime - startTime) / 1000).toFixed(2)
    spinner.stop(`Failed to upload bundle ( after ${uploadTime} seconds)`)
    if (errorUpload instanceof HTTPError) {
      try {
        const text = await errorUpload.response.text()
        if (text.startsWith('<?xml')) {
          // Parse XML error message
          const matches = text.match(/<Message>(.*?)<\/Message>/s)
          const message = matches ? matches[1] : 'Unknown S3 error'
          log.error(`S3 Upload Error: ${message}`)
        }
        else {
          const body = JSON.parse(text)
          log.error(`Response Error: ${body.error || body.status || body.message}`)
        }
      }
      catch {
        log.error(`Upload failed with status ${errorUpload.response.status}: ${errorUpload.message}`)
      }
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
    throw errorUpload instanceof Error ? errorUpload : new Error(String(errorUpload))
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

// It is really important that his function never terminates the program, it should always return, even if it fails
async function deleteLinkedBundleOnUpload(supabase: SupabaseType, appid: string, channel: string) {
  const { data, error } = await supabase
    .from('channels')
    .select('version ( id, name, deleted )')
    .eq('app_id', appid)
    .eq('name', channel)

  if (error) {
    log.error(`Cannot delete linked bundle on upload ${formatError(error)}`)
    return
  }

  if (data.length === 0) {
    log.warn('No linked bundle found in the channel you are trying to upload to')
    return
  }

  const version = data[0].version
  if (version.deleted) {
    log.warn('The linked bundle is already deleted')
    return
  }

  const { error: deleteError } = await supabase
    .from('app_versions')
    .update({ deleted: true })
    .eq('id', version.id)

  if (deleteError) {
    log.error(`Cannot delete linked bundle on upload ${formatError(deleteError)}`)
    return
  }

  log.info('Linked bundle deleted')
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
  selfAssign?: boolean,
) {
  const { data: versionId } = await supabase
    .rpc('get_app_versions', { apikey, name_version: bundle, appid })
    .single()

  if (!versionId)
    uploadFail('Cannot get version id, cannot set channel')

  const { data: apiAccess } = await supabase
    .rpc('is_allowed_capgkey', { apikey, keymode: ['write', 'all'] })
    .single()

  if (apiAccess) {
    const { error: dbError3, data } = await updateOrCreateChannel(supabase, {
      name: channel,
      app_id: appid,
      created_by: userId,
      version: versionId,
      owner_org: orgId,
      ...(selfAssign ? { allow_device_self_set: true } : {}),
    })
    if (dbError3)
      uploadFail(`Cannot set channel, the upload key is not allowed to do that, use the "all" for this. ${formatError(dbError3)}`)
    const bundleUrl = `${localConfig.hostWeb}/app/p/${appid}/channel/${data.id}`
    if (data?.public)
      log.info('Your update is now available in your public channel 🎉')
    else if (data?.id)
      log.info(`Link device to this bundle to try it: ${bundleUrl}`)

    if (displayBundleUrl)
      log.info(`Bundle url: ${bundleUrl}`)
  }
  else {
    log.warn('The upload key is not allowed to set the version in the channel')
  }
}

export async function getDefaulUploadChannel(appId: string, supabase: SupabaseType, hostWeb: string) {
  const { error, data } = await supabase.from('apps')
    .select('default_upload_channel')
    .single()

  if (error) {
    log.warn('Cannot find default upload channel')
    log.info(`You can set it here:  ${hostWeb}/app/p/${appId}/settings`)
    return null
  }

  return data.default_upload_channel
}

export async function uploadBundle(preAppid: string, options: OptionsUpload, shouldExit = true): Promise<UploadBundleResult> {
  if (shouldExit)
    intro(`Uploading with CLI version ${pack.version}`)
  let sessionKey: Buffer | undefined
  const pm = getPMAndCommand()
  await checkAlerts()

  const { s3Region, s3Apikey, s3Apisecret, s3BucketName, s3Endpoint, s3Port, s3SSL } = options

  const apikey = getApikey(options)
  const extConfig = await getConfig()
  const fileConfig = await getRemoteFileConfig()
  const { appid, path } = getAppIdAndPath(preAppid, options, extConfig.config)
  const bundle = await getBundle(extConfig.config, options)
  const defaultStorageProvider: Exclude<UploadBundleResult['storageProvider'], undefined> = options.external ? 'external' : 'r2-direct'
  let encryptionMethod: UploadBundleResult['encryptionMethod'] = 'none'

  if (options.autoSetBundle) {
    await updateConfigUpdater({ version: bundle })
  }

  checkNotifyAppReady(options, path)

  log.info(`Upload ${appid}@${bundle} started from path "${path}" to Capgo cloud`)

  const localConfig = await getLocalConfig()
  if (options.supaHost && options.supaAnon) {
    log.info('Using custom supabase instance from provided options')
    localConfig.supaHost = options.supaHost
    localConfig.supaKey = options.supaAnon
  }
  const supabase = await createSupabaseClient(apikey, options.supaHost, options.supaAnon)
  const userId = await verifyUser(supabase, apikey, ['write', 'all', 'upload'])
  const channel = options.channel || await getDefaulUploadChannel(appid, supabase, localConfig.hostWeb) || 'dev'

  // Now if it does exist we will fetch the org id
  const orgId = await getOrganizationId(supabase, appid)
  await checkRemoteCliMessages(supabase, orgId, pack.version)
  await checkPlanValidUpload(supabase, orgId, apikey, appid, true)
  await checkTrial(supabase, orgId, localConfig)

  const { nativePackages, minUpdateVersion } = await verifyCompatibility(supabase, pm, options, channel, appid, bundle)
  const versionAlreadyExists = await checkVersionExists(supabase, appid, bundle, options.versionExistsOk)
  if (versionAlreadyExists) {
    return {
      success: true,
      skipped: true,
      reason: 'VERSION_EXISTS',
      bundle,
      checksum: null,
      encryptionMethod,
      storageProvider: defaultStorageProvider,
    }
  }

  if (options.external && !options.external.startsWith('https://')) {
    uploadFail(`External link should should start with "https://" current is "${options.external}"`)
  }

  if (options.deleteLinkedBundleOnUpload) {
    log.warn('Deleting linked bundle on upload is destructive, it will delete the currently linked bundle in the channel you are trying to upload to.')
    log.warn('Please make sure you want to do this, if you are not sure, please do not use this option.')
  }

  const versionData = {
    name: bundle,
    app_id: appid,
    session_key: undefined as undefined | string,
    external_url: options.external,
    storage_provider: defaultStorageProvider,
    min_update_version: minUpdateVersion,
    native_packages: nativePackages,
    owner_org: orgId,
    user_id: userId,
    checksum: undefined as undefined | string,
    link: options.link || null,
    comment: options.comment || null,
  } as Database['public']['Tables']['app_versions']['Insert']

  let zipped: Buffer | null = null
  let finalKeyData = ''
  if (!options.external) {
    const { zipped: _zipped, ivSessionKey, checksum, sessionKey: sk, encryptionMethod: em, finalKeyData: fkd } = await prepareBundleFile(path, options, apikey, orgId, appid, fileConfig.maxUploadLength, fileConfig.alertUploadSize)
    versionData.session_key = ivSessionKey
    versionData.checksum = checksum
    sessionKey = sk
    zipped = _zipped
    encryptionMethod = em
    finalKeyData = fkd
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

  if (options.zip) {
    options.tus = false
  }
  // ALLOW TO OVERRIDE THE FILE CONFIG WITH THE OPTIONS IF THE FILE CONFIG IS FORCED
  else if (!fileConfig.TUSUpload || options.external) {
    options.tus = false
  }
  else {
    options.tus = options.tus || fileConfig.TUSUploadForced
  }
  if (!fileConfig.partialUpload || options.external) {
    options.delta = false
  }
  else {
    options.delta = options.delta || options.partial || options.deltaOnly || options.partialOnly || fileConfig.partialUploadForced
  }

  if (options.encryptPartial && encryptionMethod === 'v1')
    uploadFail('You cannot encrypt the partial update if you are not using the v2 encryption method')

  // Auto-encrypt partial updates for updater versions > 6.14.5 if encryption method is v2
  if (options.delta && encryptionMethod === 'v2' && !options.encryptPartial) {
    // Check updater version
    const root = join(findRoot(cwd()), PACKNAME)
    const dependencies = await getAllPackagesDependencies(undefined, options.packageJson || root)
    const updaterVersion = dependencies.get('@capgo/capacitor-updater')
    const coerced = coerceVersion(updaterVersion)

    if (updaterVersion && coerced && semverGte(coerced.version, '6.14.4')) {
      log.info(`Auto-enabling partial update encryption for updater version ${coerced.version} (> 6.14.4)`)
      options.encryptPartial = true
    }
  }

  const manifest: manifestType = options.delta ? await prepareBundlePartialFiles(path, apikey, orgId, appid, options.encryptPartial ? encryptionMethod : 'none', finalKeyData) : []

  const { error: dbError } = await updateOrCreateVersion(supabase, versionData)
  if (dbError)
    uploadFail(`Cannot add bundle ${formatError(dbError)}`)
  if (options.tusChunkSize && options.tusChunkSize > fileConfig.maxChunkSize) {
    log.error(`Chunk size ${options.tusChunkSize} is greater than the maximum chunk size ${fileConfig.maxChunkSize}, using the maximum chunk size`)
    options.tusChunkSize = fileConfig.maxChunkSize
  }
  else if (!options.tusChunkSize) {
    options.tusChunkSize = fileConfig.maxChunkSize
  }

  if (zipped && (s3BucketName || s3Endpoint || s3Region || s3Apikey || s3Apisecret || s3Port || s3SSL)) {
    if (!s3BucketName || !s3Endpoint || !s3Region || !s3Apikey || !s3Apisecret || !s3Port)
      uploadFail('Missing argument, for S3 upload you need to provide a bucket name, endpoint, region, port, API key, and API secret')

    log.info('Uploading to S3')
    const endPoint = s3SSL ? `https://${s3Endpoint}` : `http://${s3Endpoint}`
    const s3Client = new S3Client({
      endPoint: s3Endpoint,
      region: s3Region,
      port: s3Port,
      pathStyle: true,
      bucket: s3BucketName,
      accessKey: s3Apikey,
      secretKey: s3Apisecret,
    })
    const fileName = `${appid}-${bundle}`
    const encodeFileName = encodeURIComponent(fileName)
    await s3Client.putObject(fileName, Uint8Array.from(zipped))
    versionData.external_url = `${endPoint}/${encodeFileName}`
    versionData.storage_provider = 'external'
  }
  else if (zipped) {
    if (!options.partialOnly && !options.deltaOnly) {
      await uploadBundleToCapgoCloud(apikey, supabase, appid, bundle, orgId, zipped, options, options.tusChunkSize)
    }

    let finalManifest: Awaited<ReturnType<typeof uploadPartial>> | null = null
    try {
      if (options.dryUpload) {
        options.delta = false
      }
      const encryptionData = versionData.session_key && options.encryptPartial && sessionKey
        ? {
            sessionKey,
            ivSessionKey: versionData.session_key,
          }
        : undefined

      finalManifest = options.delta
        ? await uploadPartial(
            apikey,
            manifest,
            path,
            appid,
            bundle,
            orgId,
            encryptionData,
            options,
          )
        : null
    }
    catch (err) {
      log.info(`Failed to upload partial files to capgo cloud. Error: ${formatError(err)}. This is not a critical error, the bundle has been uploaded without the partial files`)
    }

    versionData.storage_provider = 'r2'
    versionData.manifest = finalManifest
    const { error: dbError2 } = await updateOrCreateVersion(supabase, versionData)
    if (dbError2)
      uploadFail(`Cannot update bundle ${formatError(dbError2)}`)
  }

  // Check we have app access to this appId
  const permissions = await checkAppExistsAndHasPermissionOrgErr(supabase, apikey, appid, OrganizationPerm.upload)

  if (options.deleteLinkedBundleOnUpload && hasOrganizationPerm(permissions, OrganizationPerm.write)) {
    await deleteLinkedBundleOnUpload(supabase, appid, channel)
  }
  else if (options.deleteLinkedBundleOnUpload) {
    log.warn('Cannot delete linked bundle on upload as a upload organization member')
  }

  if (hasOrganizationPerm(permissions, OrganizationPerm.write)) {
    await setVersionInChannel(supabase, apikey, !!options.bundleUrl, bundle, channel, userId, orgId, appid, localConfig, options.selfAssign)
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
  const result: UploadBundleResult = {
    success: true,
    bundle,
    checksum: versionData.checksum ?? null,
    encryptionMethod,
    sessionKey: sessionKey ? sessionKey.toString('base64') : undefined,
    ivSessionKey: typeof versionData.session_key === 'string' ? versionData.session_key : undefined,
    storageProvider: versionData.storage_provider,
  }

  if (shouldExit && !result.skipped)
    outro('Time to share your update to the world 🌍')

  return result
}

function checkValidOptions(options: OptionsUpload) {
  if (options.ivSessionKey && !options.external) {
    uploadFail('You need to provide an external url if you want to use the --iv-session-key option')
  }
  if (options.encryptedChecksum && !options.external) {
    uploadFail('You need to provide an external url if you want to use the --encrypted-checksum option')
  }
  if ((options.partial || options.delta || options.partialOnly || options.deltaOnly) && options.external) {
    uploadFail('You cannot use the --partial/--delta/--partial-only/--delta-only option with an external url')
  }
  if (options.tus && options.external) {
    uploadFail('You cannot use the --tus option with an external url')
  }
  if (options.dryUpload && options.external) {
    uploadFail('You cannot use the --dry-upload option with an external url')
  }
  if (options.multipart && options.external) {
    uploadFail('You cannot use the --multipart option with an external url')
  }
  // cannot set key if external
  if (options.external && (options.keyV2 || options.keyDataV2)) {
    uploadFail('You cannot set a key if you are uploading to an external url')
  }
  // cannot set key-v2 and key-data-v2
  if (options.keyV2 && options.keyDataV2) {
    uploadFail('You cannot set both key-v2 and key-data-v2')
  }
  // cannot set s3 and external
  if (options.external && (options.s3Region || options.s3Apikey || options.s3Apisecret || options.s3Endpoint || options.s3BucketName || options.s3Port || options.s3SSL)) {
    uploadFail('You cannot set S3 options if you are uploading to an external url, it\'s automatically handled')
  }
  // cannot set --encrypted-checksum if not external
  if (options.encryptedChecksum && !options.external) {
    uploadFail('You cannot set the --encrypted-checksum option if you are not uploading to an external url')
  }
  // cannot set min-update-version and auto-min-update-version
  if (options.minUpdateVersion && options.autoMinUpdateVersion) {
    uploadFail('You cannot set both min-update-version and auto-min-update-version, use only one of them')
  }
}

export async function uploadCommand(appid: string, options: OptionsUpload) {
  try {
    checkValidOptions(options)
    await uploadBundle(appid, options, true)
  }
  catch (error) {
    log.error(formatError(error))
    throw error instanceof Error ? error : new Error(String(error))
  }
}
