import { createReadStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { buffer as readBuffer } from 'node:stream/consumers'
import type LogSnag from 'logsnag'
import ky, { HTTPError } from 'ky'
import { log, spinner as spinnerC } from '@clack/prompts'
import type { manifestType, uploadUrlsType } from '../utils'
import { UPLOAD_TIMEOUT, formatError, generateManifest, manifestUploadUrls } from '../utils'

export async function prepareBundlePartialFiles(path: string, snag: LogSnag, orgId: string, appid: string) {
  const spinner = spinnerC()
  spinner.start('Generating the update manifest')
  const manifest = await generateManifest(path)
  spinner.stop('Manifest generated successfully')

  await snag.track({
    channel: 'partial-update',
    event: 'Generate manifest',
    icon: '📂',
    user_id: orgId,
    tags: {
      'app-id': appid,
    },
    notify: false,
  }).catch()

  return manifest
}

export async function uploadPartial(apikey: string, manifest: manifestType, path: string, options: Options, appId: string, name: string) {
  const spinner = spinnerC()
  spinner.start('Preparing partial update')
  const uploadResponse: uploadUrlsType[] = await manifestUploadUrls(apikey, appId, name, manifest)

  if (uploadResponse.length === 0 || uploadResponse.length !== manifest.length) {
    log.error(`Cannot upload manifest, please try again later`)
    spinner.stop('Partial update failed')
    return []
  }
  spinner.message('Uploading partial update')
  for (const [index, manifestEntry] of uploadResponse.entries()) {
    const finalFilePath = `${path}/${manifestEntry.path}`
    spinner.message(`Uploading partial update ${index + 1}/${uploadResponse.length}`)
    const fileStream = createReadStream(finalFilePath).pipe(createGzip({ level: 9 }))
    const fileBuffer = await readBuffer(fileStream)

    try {
      await ky.put(manifestEntry.uploadLink, {
        timeout: options.timeout || UPLOAD_TIMEOUT,
        retry: 5,
        body: fileBuffer,
      })
    }
    catch (errorUpload) {
      if (errorUpload instanceof HTTPError) {
        errorUpload.response.text()
          .then(body => log.error(`Response: ${formatError(body)}`))
          .catch(() => log.error('Cannot get response body'))
      }
      else {
        console.error(errorUpload)
      }
      return null
    }
  }

  spinner.stop('Partial update uploaded successfully')
  return uploadResponse.map((entry) => {
    return {
      file_name: entry.path,
      s3_path: entry.finalPath,
      file_hash: entry.hash,
    }
  })
}
