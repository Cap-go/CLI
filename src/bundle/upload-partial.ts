import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createGzip, gzipSync } from 'node:zlib'
import { buffer as readBuffer } from 'node:stream/consumers'
import ciDetect from 'ci-info'
import * as p from '@clack/prompts'
import { program } from 'commander'
import { promiseFiles } from 'node-dir'
import { z } from 'zod'
import ky from 'ky'
import { encryptSource, encryptSourceExpanded } from '../api/crypto'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { checkLatest } from '../api/update'
import { EMPTY_UUID, OrganizationPerm, baseKey, checKOldEncryption, checkPlanValid, createSupabaseClient, findSavedKey, formatError, getConfig, getLocalConfig, regexSemver, updateOrCreateVersion, useLogSnag, verifyUser } from '../utils'
import type { Options } from './upload'
import { checkIndexPosition, searchInDirectory } from './check'

// TODO: more validation
const uploadManifestSchema = z.object({
  file: z.string(),
  uploadUrl: z.string(),
}).array()

export async function uploadBundle(appid: string, options: Options, _shouldExit = true) {
  p.intro(`Uploading`)

  await checkLatest()
  let { bundle, path, channel } = options
  const { external, key } = options
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
  bundle = bundle || config?.app?.package?.version || `0.0.1-beta.${uuid}`
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

  const permissions = await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appid, OrganizationPerm.upload)
  await checkPlanValid(supabase, userId, options.apikey, appid, true)

  // TODO: compatibility

  const { data: isTrial, error: isTrialsError } = await supabase
    .rpc('is_trial', { userid: userId })
    .single()
  if ((isTrial && isTrial > 0) || isTrialsError) {
    p.log.warn(`WARNING !!\nTrial expires in ${isTrial} days`)
    p.log.warn(`Upgrade here: ${localConfig.hostWeb}/dashboard/settings/plans`)
  }

  // check if version already exist
  const { data: appVersion, error: appVersionError } = await supabase
    .rpc('exist_app_versions', { appid, apikey: options.apikey, name_version: bundle })
    .single()

  if (appVersion || appVersionError) {
    p.log.error(`Version already exists ${formatError(appVersionError)}`)
    program.error('')
  }

  // Now the fun starts - we have to gen a manifest ;-)
  if (external) {
    p.log.error('External partial upload is not yet supported')
    program.error('')
  }

  const spinner = p.spinner()
  spinner.start('Generating the update manifest')
  const manifest = await generateManifest(path)
  spinner.stop('Manifest generated successfully')

  const versionData = {
    // bucket_id: external ? undefined : fileName,
    name: bundle,
    app_id: appid,
    owner_org: EMPTY_UUID,
    user_id: userId,
    storage_provider: 'r2-direct-partial',
  }

  const { error: dbError } = await updateOrCreateVersion(supabase, versionData)
  if (dbError) {
    p.log.error(`Cannot add bundle ${formatError(dbError)}`)
    program.error('')
  }

  // Setup encryption
  let ivSessionKey = ''
  let keyData = options.keyData || ''
  const initVector = randomBytes(16)
  const sessionKey = randomBytes(16)

  if (key || existsSync(baseKey)) {
    await checKOldEncryption()
    const privateKey = typeof key === 'string' ? key : baseKey

    if (!keyData && !existsSync(privateKey)) {
      p.log.error(`Cannot find private key ${privateKey}`)
      if (ciDetect.isCI)
        program.error('')

      const res = await p.confirm({ message: 'Do you want to use our public key ?' })
      if (!res) {
        p.log.error(`Error: Missing public key`)
        program.error('')
      }
      keyData = localConfig.signKey || ''
    }

    // open with fs privateKey path
    if (!keyData) {
      const keyFile = readFileSync(privateKey)
      keyData = keyFile.toString()
    }
  }

  const spinner2 = p.spinner()
  spinner.start(`Uploading Bundle`)

  try {
    const { data: uploadManifest, error: uploadManifestError } = await supabase.functions.invoke('partial_upload/upload', {
      body: {
        app_id: appid,
        version: bundle,
        manifest,
      },
    })

    if (uploadManifestError) {
      spinner2.stop(`Failed to upload the bundle ${formatError(uploadManifestError)}`)
      program.error('')
    }

    const safeParsedManifest = uploadManifestSchema.safeParse(uploadManifest)
    if (!safeParsedManifest.success) {
      console.log(`Response: ${uploadManifest}`)
      spinner2.stop(`Failed to upload the bundle. The backend did not return a valid upload manifest`)
      console.error(safeParsedManifest.error)
      program.error('')
    }

    for (const manifestEntry of safeParsedManifest.data) {
      let filePath = path
      if (!filePath.endsWith('/'))
        filePath = `${filePath}/`
      filePath = `${filePath}${manifestEntry.file}`

      // Read the file
      // It will be slow as the gzip is at max level, i don;t care.
      // I want all files to be a small as possible. the cli can wait - the user cannot
      const fileStream = createReadStream(filePath).pipe(createGzip({ level: 9 }))
      let fileBuffer = await readBuffer(fileStream)

      // Now we encrypt if the key data != null
      if (keyData) {
        const encrypted = encryptSourceExpanded(fileBuffer, keyData, initVector, sessionKey)
        ivSessionKey = encrypted.ivSessionKey
        fileBuffer = encrypted.encryptedData
      }

      // Upload to S3
      await ky.put(manifestEntry.uploadUrl, {
        timeout: 60000,
        body: fileBuffer,
        headers: (!localS3
          ? {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=456789, immutable',
            // TODO: 'x-amz-meta-crc32': checksum,
          }
          : undefined),
      })
    }
  }
  catch (e: any) {
    console.error(e)
    spinner2.stop(`Failed to upload the bundle`)
    program.error('')
  }

  const { error: updateBundleError } = await supabase.from('app_versions')
    .update({ storage_provider: 'r2-partial', session_key: ivSessionKey })
    .eq('name', bundle)
    .eq('app_id', appid)
    .eq('user_id', userId)

  if (updateBundleError) {
    p.log.error(`Cannot finalize the app upload ${formatError(updateBundleError)}`)
    program.error('')
  }

  spinner.stop('Bundle Uploaded 💪')
}

async function generateManifest(path: string): Promise<{ file: string, hash: string }[]> {
  const allFiles = (await promiseFiles(path))
    .map((file) => {
      const buffer = readFileSync(file)
      const hash = createHash('sha-256').update(buffer).digest('hex')
      let filePath = file.replace(path, '')
      if (filePath.startsWith('/'))
        filePath = filePath.substring(1, filePath.length)
      return { file: filePath, hash }
    })
  return allFiles
}
