import { createReadStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { buffer as readBuffer } from 'node:stream/consumers'
import { join } from 'node:path'
import type LogSnag from 'logsnag'
import { log, spinner as spinnerC } from '@clack/prompts'
import * as tus from 'tus-js-client'
import type { manifestType } from '../utils'
import { generateManifest, useLogSnag } from '../utils'

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

export async function uploadPartial(apikey: string, manifest: manifestType, path: string, appId: string, name: string, orgId: string): Promise<any[] | null> {
  const spinner = spinnerC()
  spinner.start('Preparing partial update with TUS protocol')
  const snag = useLogSnag()

  let uploadedFiles = 0
  const totalFiles = manifest.length

  const uploadFiles = manifest.map(async (file) => {
    const finalFilePath = join(path, file.file)
    const fileStream = createReadStream(finalFilePath).pipe(createGzip({ level: 9 }))
    const fileBuffer = await readBuffer(fileStream)

    return new Promise((resolve, reject) => {
      const upload = new tus.Upload(fileBuffer as any, {
        endpoint: 'https://api.capgo.app/private/files/upload/attachments/',
        metadata: {
          filename: `orgs/${orgId}/apps/${appId}/${name}/${file.file}`,
          filetype: 'application/gzip',
        },
        headers: {
          Authorization: apikey,
        },
        onError(error) {
          log.error(`Failed to upload ${file.file}: ${error}`)
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
    spinner.stop('Partial update uploaded successfully with TUS protocol')

    await snag.track({
      channel: 'app',
      event: 'App Partial TUS done',
      icon: '⏫',
      user_id: orgId,
      tags: {
        'app-id': appId,
      },
      notify: false,
    }).catch()

    return results
  }
  catch (error) {
    spinner.stop('Partial update failed')
    log.error(`Error uploading partial update: ${error}`)
    return null
  }
}
