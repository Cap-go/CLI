import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { exit } from 'node:process'
import type { Buffer } from 'node:buffer'
import { program } from 'commander'
import { checksum as getChecksum } from '@tomasklaen/checksum'
import ciDetect from 'ci-info'
import type LogSnag from 'logsnag'
import { S3Client } from '@bradenmacdonald/s3-lite-client'
import ky, { HTTPError } from 'ky'
import { confirm as confirmC, intro, log, outro, spinner as spinnerC } from '@clack/prompts'
import { encryptSource } from '../api/crypto'
import { type OptionsBase, OrganizationPerm, baseKeyPub, checkChecksum, checkCompatibility, checkPlanValid, convertAppName, createSupabaseClient, deletedFailedVersion, findSavedKey, formatError, getConfig, getLocalConfig, getLocalDepenencies, getOrganizationId, getPMAndCommand, hasOrganizationPerm, readPackageJson, regexSemver, updateOrCreateChannel, updateOrCreateVersion, uploadMultipart, uploadUrl, useLogSnag, verifyUser, zipFile } from '../utils'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { checkLatest } from '../api/update'
import type { CapacitorConfig } from '../config'
import { checkIndexPosition, searchInDirectory } from './check'

interface Options extends OptionsBase {
  bundle?: string
  path?: string
  channel?: string
  displayIvSession?: boolean
  external?: string
  key?: boolean | string
  keyData?: string
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
  minUpdateVersion?: string
  autoMinUpdateVersion?: boolean
  ignoreMetadataCheck?: boolean
  ignoreChecksumCheck?: boolean
  timeout?: number
  multipart?: boolean
}

const alertMb = 20
const UPLOAD_TIMEOUT = 120000

type SupabaseType = Awaited<ReturnType<typeof createSupabaseClient>>
type pmType = ReturnType<typeof getPMAndCommand>
type localConfigType = Awaited<ReturnType<typeof getLocalConfig>>

async function getBundle(config: CapacitorConfig, options: Options) {
  const pkg = await readPackageJson()
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
  const finalAppId = appId || config?.appId
  const path = options.path || config?.webDir

  if (!finalAppId || !path) {
    log.error('Missing argument, you need to provide a appid and a path (--path), or be in a capacitor project')
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
      log.error(`index.html is missing in the root folder or in the only folder in the root folder`)
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
    .select('disableAutoUpdate, version ( minUpdateVersion, native_packages )')
    .eq('name', channel)
    .eq('app_id', appid)
    .single()

  const updateMetadataRequired = !!channelData && channelData.disableAutoUpdate === 'version_number'

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
    } = await checkCompatibility(supabase, appid, channel)

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
        const { minUpdateVersion: lastMinUpdateVersion } = channelData.version as any
        if (!lastMinUpdateVersion || !regexSemver.test(lastMinUpdateVersion)) {
          log.error('Invalid remote min update version, skipping auto setting compatibility')
          program.error('')
        }

        minUpdateVersion = lastMinUpdateVersion
        spinner.stop(`Auto set min-update-version to ${minUpdateVersion}`)
      }
      catch (error) {
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
    localDependencies = await getLocalDepenencies()

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
    log.error(`Version already exists ${formatError(appVersionError)}`)
    program.error('')
  }
}

async function prepareBundleFile(path: string, options: Options, localConfig: localConfigType, snag: LogSnag, orgId: string, appid: string) {
  let sessionKey
  let checksum = ''
  let zipped: Buffer | null = null
  const key = options.key

  zipped = await zipFile(path)
  const s = spinnerC()
  s.start(`Calculating checksum`)
  checksum = await getChecksum(zipped, 'crc32')
  s.stop(`Checksum: ${checksum}`)
  // key should be undefined or a string if false it should ingore encryption
  if (!key) {
    log.info(`Encryption ignored`)
  }
  else if (key || existsSync(baseKeyPub)) {
    const publicKey = typeof key === 'string' ? key : baseKeyPub
    let keyData = options.keyData || ''
    // check if publicKey exist
    if (!keyData && !existsSync(publicKey)) {
      log.error(`Cannot find public key ${publicKey}`)
      if (ciDetect.isCI) {
        log.error('Cannot ask if user wants to use capgo public key on the cli')
        program.error('')
      }

      const res = await confirmC({ message: 'Do you want to use our public key ?' })
      if (!res) {
        log.error(`Error: Missing public key`)
        program.error('')
      }
      keyData = localConfig.signKey || ''
    }
    await snag.track({
      channel: 'app',
      event: 'App encryption',
      icon: '🔑',
      user_id: orgId,
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
  if (mbSize > alertMb) {
    log.warn(`WARNING !!\nThe app size is ${mbSize} Mb, this may take a while to download for users\n`)
    log.info(`Learn how to optimize your assets https://capgo.app/blog/optimise-your-images-for-updates/\n`)
    await snag.track({
      channel: 'app-error',
      event: 'App Too Large',
      icon: '🚛',
      user_id: orgId,
      tags: {
        'app-id': appid,
      },
      notify: false,
    }).catch()
  }

  return { zipped, sessionKey, checksum }
}

async function uploadBundleToCapgoCloud(supabase: SupabaseType, appid: string, bundle: string, orgId: string, zipped: Buffer, options: Options) {
  const spinner = spinnerC()
  spinner.start(`Uploading Bundle`)
  const startTime = performance.now()

  try {
    if (options.multipart !== undefined && options.multipart) {
      log.info(`Uploading bundle as multipart`)
      await uploadMultipart(supabase, appid, bundle, zipped, orgId)
    }
    else {
      const url = await uploadUrl(supabase, appid, bundle)
      if (!url) {
        log.error(`Cannot get upload url`)
        program.error('')
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
    log.error(`Cannot upload bundle ( try again with --multipart option) ${formatError(errorUpload)}`)
    if (errorUpload instanceof HTTPError) {
      const body = await errorUpload.response.text()
      log.error(`Response: ${formatError(body)}`)
    }
    // call delete version on path /delete_failed_version to delete the version
    await deletedFailedVersion(supabase, appid, bundle)
    program.error('')
  }

  const endTime = performance.now()
  const uploadTime = ((endTime - startTime) / 1000).toFixed(2)
  spinner.stop(`Bundle Uploaded 💪 (${uploadTime} seconds)`)
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
  permissions: OrganizationPerm,
) {
  const { data: versionId } = await supabase
    .rpc('get_app_versions', { apikey, name_version: bundle, appid })
    .single()

  if (versionId && hasOrganizationPerm(permissions, OrganizationPerm.write)) {
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
    else if (!hasOrganizationPerm(permissions, OrganizationPerm.write)) {
      log.warn('Cannot set channel as a upload organization member')
    }
  }
}

export async function uploadBundle(preAppid: string, options: Options, shouldExit = true) {
  intro(`Uploading`)
  const pm = getPMAndCommand()
  await checkLatest()

  const { s3Region, s3Apikey, s3Apisecret, s3BucketName, s3Endpoint, s3Port, s3SSL } = options

  const apikey = getApikey(options)
  const extConfig = await getConfig()
  const { appid, path } = getAppIdAndPath(preAppid, options, extConfig.config)
  const bundle = await getBundle(extConfig.config, options)
  const channel = options.channel || 'dev'
  const snag = useLogSnag()

  checkNotifyAppReady(options, path)

  log.info(`Upload ${appid}@${bundle} started from path "${path}" to Capgo cloud`)

  const localConfig = await getLocalConfig()
  const supabase = await createSupabaseClient(apikey)
  const userId = await verifyUser(supabase, apikey, ['write', 'all', 'upload'])
  // Check we have app access to this appId
  const permissions = await checkAppExistsAndHasPermissionOrgErr(supabase, apikey, appid, OrganizationPerm.upload)

  // Now if it does exist we will fetch the org id
  const orgId = await getOrganizationId(supabase, appid)
  await checkPlanValid(supabase, orgId, apikey, appid, true)
  await checkTrial(supabase, orgId, localConfig)
  const { nativePackages, minUpdateVersion } = await verifyCompatibility(supabase, pm, options, channel, appid, bundle)
  await checkVersionExists(supabase, appid, bundle)

  if (options.external && !options.external.startsWith('https://')) {
    log.error(`External link should should start with "https://" current is "${external}"`)
    program.error('')
  }

  const versionData = {
    // bucket_id: external ? undefined : fileName,
    name: bundle,
    app_id: appid,
    session_key: undefined as undefined | string,
    external_url: options.external,
    storage_provider: options.external ? 'external' : 'r2-direct',
    minUpdateVersion,
    native_packages: nativePackages,
    owner_org: orgId,
    user_id: userId,
    checksum: undefined as undefined | string,
  }

  let zipped: Buffer | null = null
  if (!options.external) {
    const { zipped: _zipped, sessionKey, checksum } = await prepareBundleFile(path, options, localConfig, snag, orgId, appid)
    versionData.session_key = sessionKey
    versionData.checksum = checksum
    zipped = _zipped
    if (!options.ignoreChecksumCheck) {
      await checkChecksum(supabase, appid, channel, checksum)
    }
  }
  else {
    await snag.track({
      channel: 'app',
      event: 'App external',
      icon: '📤',
      user_id: orgId,
      tags: {
        'app-id': appid,
      },
      notify: false,
    }).catch()
    versionData.session_key = options.ivSessionKey
  }

  const { error: dbError } = await updateOrCreateVersion(supabase, versionData)
  if (dbError) {
    log.error(`Cannot add bundle ${formatError(dbError)}`)
    program.error('')
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
      credentials: {
        accessKeyId: s3Apikey,
        secretAccessKey: s3Apisecret,
      },
    })
    const fileName = `${appid}-${bundle}`
    const encodeFileName = encodeURIComponent(fileName)
    await s3Client.putObject(fileName, zipped)
    versionData.external_url = `https://${s3Endpoint}/${encodeFileName}`
    versionData.storage_provider = 'external'
  }
  else if (zipped) {
    await uploadBundleToCapgoCloud(supabase, appid, bundle, orgId, zipped, options)

    versionData.storage_provider = 'r2'
    const { error: dbError2 } = await updateOrCreateVersion(supabase, versionData)
    if (dbError2) {
      log.error(`Cannot update bundle ${formatError(dbError2)}`)
      program.error('')
    }
  }

  await setVersionInChannel(supabase, apikey, !!options.bundleUrl, bundle, channel, userId, orgId, appid, localConfig, permissions)

  await snag.track({
    channel: 'app',
    event: 'App Uploaded',
    icon: '⏫',
    user_id: orgId,
    tags: {
      'app-id': appid,
    },
    notify: false,
  }).catch()
  if (shouldExit) {
    outro('Time to share your update to the world 🌍')
    exit()
  }
  return true
}

export async function uploadCommand(appid: string, options: Options) {
  try {
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
    await uploadBundle(appid, options, true)
  }
  catch (error) {
    log.error(formatError(error))
    program.error('')
  }
}
