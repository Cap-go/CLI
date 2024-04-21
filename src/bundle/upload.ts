import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import type { Buffer } from 'node:buffer'
import AdmZip from 'adm-zip'
import { program } from 'commander'
import * as p from '@clack/prompts'
import { checksum as getChecksum } from '@tomasklaen/checksum'
import ciDetect from 'ci-info'
import ky from 'ky'
import {
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { checkLatest } from '../api/update'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { encryptSource } from '../api/crypto'
import type {
  OptionsBase,
} from '../utils'
import {
  EMPTY_UUID,
  OrganizationPerm,
  baseKey,
  checKOldEncryption,
  checkCompatibility,
  checkPlanValid,
  convertAppName,
  createSupabaseClient,
  findSavedKey,
  formatError,
  getAppOwner,
  getConfig,
  getLocalConfig,
  getLocalDepenencies,
  getOrganizationId,
  hasOrganizationPerm,
  regexSemver,
  requireUpdateMetadata,
  updateOrCreateChannel,
  updateOrCreateVersion,
  uploadUrl,
  useLogSnag,
  verifyUser,
} from '../utils'
import { checkIndexPosition, searchInDirectory } from './check'

const alertMb = 20

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
  bundleUrl?: boolean
  codeCheck?: boolean
  minUpdateVersion?: string
  autoMinUpdateVersion?: boolean
  ignoreMetadataCheck?: boolean
}

export async function uploadBundle(appid: string, options: Options, shouldExit = true) {
  p.intro(`Uploading`)
  await checkLatest()
  let { bundle, path, channel } = options
  const { external, key, displayIvSession, autoMinUpdateVersion, ignoreMetadataCheck } = options
  let { minUpdateVersion } = options
  const { s3Region, s3Apikey, s3Apisecret, s3BucketName } = options
  let useS3 = false
  let s3Client
  if (s3Region && s3Apikey && s3Apisecret && s3BucketName) {
    p.log.info('Uploading to S3')
    useS3 = true
    s3Client = new S3Client({
      region: s3Region,
      credentials: {
        accessKeyId: s3Apikey,
        secretAccessKey: s3Apisecret,
      },
    })
  }

  options.apikey = options.apikey || findSavedKey()
  const snag = useLogSnag()

  channel = channel || 'dev'

  const config = await getConfig()
  const localS3: boolean = (config.app.extConfig.plugins && config.app.extConfig.plugins.CapacitorUpdater
    && config.app.extConfig.plugins.CapacitorUpdater.localS3) === true

  const checkNotifyAppReady = options.codeCheck
  appid = appid || config?.app?.appId
  // create bundle name format : 1.0.0-beta.x where x is a uuid
  const uuid = randomUUID().split('-')[0]
  bundle = bundle || config?.app?.extConfig?.plugins?.CapacitorUpdater?.version || config?.app?.package?.version || `0.0.1-beta.${uuid}`
  // check if bundle is valid
  if (!regexSemver.test(bundle)) {
    p.log.error(`Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`)
    program.error('')
  }
  path = path || config?.app?.webDir
  if (!options.apikey) {
    p.log.error(`Missing API key, you need to provide a API key to upload your bundle`)
    program.error('')
  }
  if (!appid || !bundle || !path) {
    p.log.error('Missing argument, you need to provide a appid and a bundle and a path, or be in a capacitor project')
    program.error('')
  }
  // if one S3 variable is set, check that all are set
  if (s3BucketName || s3Region || s3Apikey || s3Apisecret) {
    if (!s3BucketName || !s3Region || !s3Apikey || !s3Apisecret) {
      p.log.error('Missing argument, for S3 upload you need to provide a bucket name, region, API key, and API secret')
      program.error('')
    }
  }
  // check if path exist
  if (!existsSync(path)) {
    p.log.error(`Path ${path} does not exist, build your app first, or provide a valid path`)
    program.error('')
  }

  if (typeof checkNotifyAppReady === 'undefined' || checkNotifyAppReady) {
    const isPluginConfigured = searchInDirectory(path, 'notifyAppReady')
    if (!isPluginConfigured) {
      p.log.error(`notifyAppReady() is missing in the source code. see: https://capgo.app/docs/plugin/api/#notifyappready`)
      program.error('')
    }
    const foundIndex = checkIndexPosition(path)
    if (!foundIndex) {
      p.log.error(`index.html is missing in the root folder or in the only folder in the root folder`)
      program.error('')
    }
  }

  p.log.info(`Upload ${appid}@${bundle} started from path "${path}" to Capgo cloud`)

  const localConfig = await getLocalConfig()
  const supabase = await createSupabaseClient(options.apikey)
  const userId = await verifyUser(supabase, options.apikey, ['write', 'all', 'upload'])
  // Check we have app access to this appId
  // await checkAppExistsAndHasPermissionErr(supabase, options.apikey, appid);

  const permissions = await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appid, OrganizationPerm.upload)

  // Now if it does exist we will fetch the org id
  const orgId = await getOrganizationId(supabase, appid)
  await checkPlanValid(supabase, orgId, options.apikey, appid, true)

  const updateMetadataRequired = await requireUpdateMetadata(supabase, channel, appid)

  // Check compatibility here
  const { data: channelData, error: channelError } = await supabase
    .from('channels')
    .select('version ( minUpdateVersion, native_packages )')
    .eq('name', channel)
    .eq('app_id', appid)
    .single()

  // eslint-disable-next-line no-undef-init
  let localDependencies: Awaited<ReturnType<typeof getLocalDepenencies>> | undefined = undefined
  let finalCompatibility: Awaited<ReturnType<typeof checkCompatibility>>['finalCompatibility']

  // We only check compatibility IF the channel exists
  if (!channelError && channelData && channelData.version && (channelData.version as any).native_packages && !ignoreMetadataCheck) {
    const spinner = p.spinner()
    spinner.start(`Checking bundle compatibility with channel ${channel}`)
    const {
      finalCompatibility: finalCompatibilityWithChannel,
      localDependencies: localDependenciesWithChannel,
    } = await checkCompatibility(supabase, appid, channel)

    finalCompatibility = finalCompatibilityWithChannel
    localDependencies = localDependenciesWithChannel

    if (finalCompatibility.find(x => x.localVersion !== x.remoteVersion)) {
      p.log.error(`Your bundle is not compatible with the channel ${channel}`)
      p.log.warn(`You can check compatibility with "npx @capgo/cli bundle compatibility"`)

      if (autoMinUpdateVersion) {
        minUpdateVersion = bundle
        p.log.info(`Auto set min-update-version to ${minUpdateVersion}`)
      }
    }
    else if (autoMinUpdateVersion) {
      try {
        const { minUpdateVersion: lastMinUpdateVersion } = channelData.version as any
        if (!lastMinUpdateVersion || !regexSemver.test(lastMinUpdateVersion)) {
          p.log.error('Invalid remote min update version, skipping auto setting compatibility')
          program.error('')
        }

        minUpdateVersion = lastMinUpdateVersion
        p.log.info(`Auto set min-update-version to ${minUpdateVersion}`)
      }
      catch (error) {
        p.log.error(`Cannot auto set compatibility, invalid data ${channelData}`)
        program.error('')
      }
    }
    spinner.stop(`Bundle compatible with ${channel} channel`)
  }
  else if (!ignoreMetadataCheck) {
    p.log.warn(`Channel ${channel} is new or it's your first upload with compatibility check, it will be ignored this time`)
    localDependencies = await getLocalDepenencies()

    if (autoMinUpdateVersion) {
      minUpdateVersion = bundle
      p.log.info(`Auto set min-update-version to ${minUpdateVersion}`)
    }
  }

  if (updateMetadataRequired && !minUpdateVersion && !ignoreMetadataCheck) {
    p.log.error(`You need to provide a min-update-version to upload a bundle to this channel`)
    program.error('')
  }

  if (minUpdateVersion) {
    if (!regexSemver.test(minUpdateVersion)) {
      p.log.error(`Your minimal version update ${minUpdateVersion}, is not valid it should follow semver convention : https://semver.org/`)
      program.error('')
    }
  }

  const { data: isTrial, error: isTrialsError } = await supabase
    .rpc('is_trial_org', { orgid: orgId })
    .single()
  if ((isTrial && isTrial > 0) || isTrialsError) {
    // TODO: Come back to this to fix for orgs v3
    p.log.warn(`WARNING !!\nTrial expires in ${isTrial} days`)
    p.log.warn(`Upgrade here: ${localConfig.hostWeb}/dashboard/settings/plans?oid=${orgId}`)
  }

  // check if app already exist
  const { data: appVersion, error: appVersionError } = await supabase
    .rpc('exist_app_versions', { appid, apikey: options.apikey, name_version: bundle })
    .single()

  if (appVersion || appVersionError) {
    p.log.error(`Version already exists ${formatError(appVersionError)}`)
    program.error('')
  }

  let sessionKey
  let checksum = ''
  let zipped: Buffer | null = null
  if (!external && useS3 === false) {
    const zip = new AdmZip()
    zip.addLocalFolder(path)
    zipped = zip.toBuffer()
    const s = p.spinner()
    s.start(`Calculating checksum`)
    checksum = await getChecksum(zipped, 'crc32')
    s.stop(`Checksum: ${checksum}`)
    if (key === false) {
      p.log.info(`Encryption ignored`)
    }
    else if (key || existsSync(baseKey)) {
      await checKOldEncryption()
      const privateKey = typeof key === 'string' ? key : baseKey
      let keyData = options.keyData || ''
      // check if privateKey exist
      if (!keyData && !existsSync(privateKey)) {
        p.log.error(`Cannot find private key ${privateKey}`)
        if (ciDetect.isCI)
          program.error('')

        const res = await p.confirm({ message: 'Do you want to use our private key ?' })
        if (!res) {
          p.log.error(`Error: Missing public key`)
          program.error('')
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
      // open with fs privateKey path
      if (!keyData) {
        const keyFile = readFileSync(privateKey)
        keyData = keyFile.toString()
      }
      // encrypt
      if (keyData && !keyData.startsWith('-----BEGIN RSA PRIVATE KEY-----')) {
        p.log.error(`the private key provided is not a valid RSA Private key`)
        program.error('')
      }
      p.log.info(`Encrypting your bundle`)
      const res = encryptSource(zipped, keyData)
      sessionKey = res.ivSessionKey
      if (displayIvSession) {
        p.log.info(`Your Iv Session key is ${sessionKey},
keep it safe, you will need it to decrypt your bundle.
It will be also visible in your dashboard\n`)
      }
      zipped = res.encryptedData
    }
    const mbSize = Math.floor(zipped.byteLength / 1024 / 1024)
    if (mbSize > alertMb) {
      p.log.warn(`WARNING !!\nThe app size is ${mbSize} Mb, this may take a while to download for users\n`)
      p.log.info(`Learn how to optimize your assets https://capgo.app/blog/optimise-your-images-for-updates/\n`)
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
  }
  else if (external && !external.startsWith('https://')) {
    p.log.error(`External link should should start with "https://" current is "${external}"`)
    program.error('')
  }
  else {
    if (useS3) {
      const zip = new AdmZip()
      zip.addLocalFolder(path)
      zipped = zip.toBuffer()
      const s = p.spinner()
      s.start(`Calculating checksum`)
      checksum = await getChecksum(zipped, 'crc32')
      s.stop(`Checksum: ${checksum}`)
    }
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

  const hashedLocalDependencies = localDependencies
    ? new Map(localDependencies
      .filter(a => !!a.native && a.native !== undefined)
      .map(a => [a.name, a]))
    : new Map()

  const nativePackages = (hashedLocalDependencies.size > 0 || !options.ignoreMetadataCheck) ? Array.from(hashedLocalDependencies, ([name, value]) => ({ name, version: value.version })) : undefined

  const appOwner = await getAppOwner(supabase, appid)

  const versionData = {
    // bucket_id: external ? undefined : fileName,
    name: bundle,
    app_id: appid,
    session_key: sessionKey,
    external_url: external,
    storage_provider: external ? 'external' : 'r2-direct',
    minUpdateVersion,
    native_packages: nativePackages,
    owner_org: EMPTY_UUID,
    user_id: userId,
    checksum,
  }
  const { error: dbError } = await updateOrCreateVersion(supabase, versionData)
  if (dbError) {
    p.log.error(`Cannot add bundle ${formatError(dbError)}`)
    program.error('')
  }
  if (!external && zipped) {
    const spinner = p.spinner()
    spinner.start(`Uploading Bundle`)

    const url = await uploadUrl(supabase, appid, bundle)
    if (!url) {
      p.log.error(`Cannot get upload url`)
      program.error('')
    }
    try {
      await ky.put(url, {
        timeout: 60000,
        retry: 5,
        body: zipped,
        headers: (!localS3
          ? {
              'Content-Type': 'application/octet-stream',
              'Cache-Control': 'public, max-age=456789, immutable',
              'x-amz-meta-crc32': checksum,
            }
          : undefined),
      })
    } catch (errorUpload) {
      p.log.error(`Cannot upload bundle ${formatError(errorUpload)}`)
      program.error('')
    }
    versionData.storage_provider = 'r2'
    const { error: dbError2 } = await updateOrCreateVersion(supabase, versionData)
    if (dbError2) {
      p.log.error(`Cannot update bundle ${formatError(dbError2)}`)
      program.error('')
    }
    spinner.stop('Bundle Uploaded 💪')
  }
  else if (useS3 && zipped) {
    const spinner = p.spinner()
    spinner.start(`Uploading Bundle`)

    const fileName = `${appid}-${bundle}`
    const encodeFileName = encodeURIComponent(fileName)
    const command: PutObjectCommand = new PutObjectCommand({
      Bucket: s3BucketName,
      Key: fileName,
      Body: zipped,
    })

    const response = await s3Client.send(command)
    if (response.$metadata.httpStatusCode !== 200) {
      p.log.error(`Cannot upload to S3`)
      program.error('')
    }

    versionData.storage_provider = 'external'
    versionData.external_url = `https://${s3BucketName}.s3.amazonaws.com/${encodeFileName}`
    const { error: dbError2 } = await updateOrCreateVersion(supabase, versionData)
    if (dbError2) {
      p.log.error(`Cannot update bundle ${formatError(dbError2)}`)
      program.error('')
    }
    spinner.stop('Bundle Uploaded 💪')
  }
  const { data: versionId } = await supabase
    .rpc('get_app_versions', { apikey: options.apikey, name_version: bundle, appid })
    .single()

  if (versionId && hasOrganizationPerm(permissions, OrganizationPerm.write)) {
    const { error: dbError3, data } = await updateOrCreateChannel(supabase, {
      name: channel,
      app_id: appid,
      created_by: appOwner,
      version: versionId,
      owner_org: EMPTY_UUID,
    })
    if (dbError3) {
      p.log.error(`Cannot set channel, the upload key is not allowed to do that, use the "all" for this. ${formatError(dbError3)}`)
      program.error('')
    }
    const appidWeb = convertAppName(appid)
    const bundleUrl = `${localConfig.hostWeb}/app/p/${appidWeb}/channel/${data.id}`
    if (data?.public)
      p.log.info('Your update is now available in your public channel 🎉')
    else if (data?.id)
      p.log.info(`Link device to this bundle to try it: ${bundleUrl}`)

    if (options.bundleUrl)
      p.log.info(`Bundle url: ${bundleUrl}`)
  }
  else if (!versionId) {
    p.log.warn('Cannot set bundle with upload key, use key with more rights for that')
    program.error('')
  }
  else if (!hasOrganizationPerm(permissions, OrganizationPerm.write)) {
    p.log.warn('Cannot set channel as a upload organization member')
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

export async function uploadCommand(apikey: string, options: Options) {
  try {
    await uploadBundle(apikey, options, true)
  }
  catch (error) {
    p.log.error(formatError(error))
    program.error('')
  }
}

export async function uploadDeprecatedCommand(apikey: string, options: Options) {
  p.log.warn('⚠️  This command is deprecated, use "npx @capgo/cli bundle upload" instead ⚠️')
  try {
    await uploadBundle(apikey, options, true)
  }
  catch (error) {
    p.log.error(formatError(error))
    program.error('')
  }
}
