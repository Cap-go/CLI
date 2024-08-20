import { createReadStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { buffer as readBuffer } from 'node:stream/consumers'
import type LogSnag from 'logsnag'
import ky, { HTTPError } from 'ky'
import EventSource from 'eventsource'
import { log, spinner as spinnerC } from '@clack/prompts'
import z from 'zod'
import chunk from 'lodash/chunk'
import type { manifestType, uploadUrlsType } from '../utils'
import { UPLOAD_TIMEOUT, defaultApiHost, formatError, generateManifest, manifestUploadUrls } from '../utils'
import type { CapacitorConfig } from '../config'

// {
//   path: body.manifest.file,
//   hash: body.manifest.hash,
//   finalPath,
//   uploadLink: url,
// }

const responseSchema = z.object({
  id: z.number().min(0).max(9),
  finalPath: z.string(),
  uploadLink: z.string().url(),
}).array()

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

export async function uploadPartial(apikey: string, manifest: manifestType, path: string, options: any, config: CapacitorConfig, appId: string, name: string) {
  try {
    const baseUrl = config?.plugins?.CapacitorUpdater?.cloudflareBaseUrl ?? defaultApiHost
    const url = new URL(`${baseUrl}/private/partial_upload/v1`)

    const res = await Promise.all(chunk(manifest, 10).map(async (entries) => {
      const response = await ky.post(url, {
        json: {
          name,
          app_id: appId,
          manifest: entries,
        },
        headers: {
          capgkey: apikey,
        },
      })

      const responseJson = await response.json()
      const parsedResponse = responseSchema.parse(responseJson)

      return await Promise.all(parsedResponse.map(async (responseEntry) => {
        const inputEntry = entries.at(responseEntry.id)
        if (!inputEntry) {
          throw new Error(`Cannot get inputEntry ${responseEntry.id} for ${JSON.stringify(entries)}`)
        }

        const finalFilePath = `${path}/${inputEntry.file}`
        // TODO: prevent directory traversal
        const fileStream = createReadStream(finalFilePath).pipe(createGzip({ level: 9 }))
        const fileBuffer = await readBuffer(fileStream)

        await ky.put(responseEntry.uploadLink, {
          timeout: options.timeout || UPLOAD_TIMEOUT,
          retry: 5,
          body: fileBuffer,
        })

        return {
          file_name: inputEntry.file,
          s3_path: responseEntry.finalPath,
          file_hash: inputEntry.hash,
        }
      }))
    }))
    return res.flat(1)
  }
  catch (errorUpload) {
    if (errorUpload instanceof HTTPError) {
      errorUpload.response.text()
        .then(body => log.error(`Response: ${formatError(body)}`))
        .catch(() => log.error('Cannot get response body'))
    }

    if (errorUpload instanceof z.ZodError) {
      log.error(`Cannot get upload url for partial update. Error:\n${JSON.stringify(errorUpload)}`)
    }

    else {
      console.error(errorUpload)
    }
  }
}

// const uploadResponse: uploadUrlsType[] = await manifestUploadUrls(apikey, appId, name, manifest)
// if (uploadResponse.length === 0 || uploadResponse.length !== manifest.length) {
//   log.error(`Cannot upload manifest, please try again later`)
//   spinner.stop('Partial update failed')
//   return []
// }
// spinner.message('Uploading partial update')
// for (const [index, manifestEntry] of uploadResponse.entries()) {
//   const finalFilePath = `${path}/${manifestEntry.path}`
//   spinner.message(`Uploading partial update ${index + 1}/${uploadResponse.length}`)
//   const fileStream = createReadStream(finalFilePath).pipe(createGzip({ level: 9 }))
//   const fileBuffer = await readBuffer(fileStream)

//   try {
//     await ky.put(manifestEntry.uploadLink, {
//       timeout: options.timeout || UPLOAD_TIMEOUT,
//       retry: 5,
//       body: fileBuffer,
//     })
//   }
//   catch (errorUpload) {
//     if (errorUpload instanceof HTTPError) {
//       errorUpload.response.text()
//         .then(body => log.error(`Response: ${formatError(body)}`))
//         .catch(() => log.error('Cannot get response body'))
//     }
//     else {
//       console.error(errorUpload)
//     }
//     return null
//   }
// }

// spinner.stop('Partial update uploaded successfully')
// return uploadResponse.map((entry) => {
//   return {
//     file_name: entry.path,
//     s3_path: entry.finalPath,
//     file_hash: entry.hash,
//   }
// })
