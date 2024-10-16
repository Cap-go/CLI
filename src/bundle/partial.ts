import type { manifestType } from '../utils'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { buffer as readBuffer } from 'node:stream/consumers'
import { createBrotliCompress } from 'node:zlib'
import { log, spinner as spinnerC } from '@clack/prompts'
import * as tus from 'tus-js-client'
import { generateManifest, getLocalConfig, sendEvent } from '../utils'

export async function prepareBundlePartialFiles(path: string, apikey: string, orgId: string, appid: string) {
  const spinner = spinnerC()
  spinner.start('Generating the update manifest')
  const manifest = await generateManifest(path)
  spinner.stop('Manifest generated successfully')

  await sendEvent(apikey, {
    channel: 'partial-update',
    event: 'Generate manifest',
    icon: '📂',
    user_id: orgId,
    tags: {
      'app-id': appid,
    },
    notify: false,
  })

  return manifest
}

export async function uploadPartial(apikey: string, manifest: manifestType, path: string, appId: string, name: string, orgId: string): Promise<any[] | null> {
  const spinner = spinnerC()
  spinner.start('Preparing partial update with TUS protocol')
  const startTime = performance.now()
  const localConfig = await getLocalConfig()

  let uploadedFiles = 0
  const totalFiles = manifest.length

  const uploadFiles = manifest.map(async (file) => {
    const finalFilePath = join(path, file.file)
    const fileStream = createReadStream(finalFilePath).pipe(createBrotliCompress())
    const fileBuffer = await readBuffer(fileStream)

    return new Promise((resolve, reject) => {
      const upload = new tus.Upload(fileBuffer as any, {
        endpoint: `${localConfig.hostFilesApi}/files/upload/attachments/`,
        metadata: {
          filename: `orgs/${orgId}/apps/${appId}/${name}/${file.file}`,
        },
        headers: {
          Authorization: apikey,
        },
        onError(error) {
          log.info(`Failed to upload ${file.file}: ${error}`)
          reject(error)
        },
        onProgress() {
          // Update progress based on number of files
          const percentage = ((uploadedFiles / totalFiles) * 100).toFixed(2)
          spinner.message(`Uploading partial update: ${percentage}%`)
        },
        onSuccess() {
          uploadedFiles++
          resolve({
            file_name: file.file,
            s3_path: `orgs/${orgId}/apps/${appId}/${name}/${file.file}`,
            file_hash: file.hash,
          })
        },
      })

      upload.start()
    })
  })

  try {
    const results = await Promise.all(uploadFiles)
    const endTime = performance.now()
    const uploadTime = ((endTime - startTime) / 1000).toFixed(2)
    spinner.stop(`Partial update uploaded successfully 💪 in (${uploadTime} seconds)`)

    await sendEvent(apikey, {
      channel: 'app',
      event: 'App Partial TUS done',
      icon: '⏫',
      user_id: orgId,
      tags: {
        'app-id': appId,
      },
      notify: false,
    })
    await sendEvent(apikey, {
      channel: 'performance',
      event: 'Partial upload performance',
      icon: '🚄',
      user_id: orgId,
      tags: {
        'app-id': appId,
        'time': uploadTime,
      },
      notify: false,
    })
    return results
  }
  catch (error) {
    const endTime = performance.now()
    const uploadTime = ((endTime - startTime) / 1000).toFixed(2)
    spinner.stop(`Failed to upload Partial bundle ( after ${uploadTime} seconds)`)
    log.info(`Error uploading partial update: ${error}, This is not a critical error, the bundle has been uploaded without the partial files`)
    return null
  }
}
