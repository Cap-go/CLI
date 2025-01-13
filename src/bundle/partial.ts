import type { TransformCallback } from 'node:stream'
import type { manifestType } from '../utils'
import { Buffer } from 'node:buffer'
import { createReadStream } from 'node:fs'
import { platform as osPlatform } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { Transform } from 'node:stream'
import { buffer as readBuffer } from 'node:stream/consumers'
import { createBrotliCompress } from 'node:zlib'

import { log, spinner as spinnerC } from '@clack/prompts'
import * as tus from 'tus-js-client'
import { encryptChecksumV2, encryptSourceV2 } from '../api/cryptoV2'
import { generateManifest, getLocalConfig, sendEvent } from '../utils'

// Custom transform stream for small files
class SmallFileTransform extends Transform {
  private isFirstChunk = true

  _transform(chunk: Buffer, encoding: string, callback: TransformCallback) {
    if (this.isFirstChunk) {
      // Add Brotli header for small files
      this.push(Buffer.from([0x8B, 0x00, 0x80])) // Standard Brotli header
      this.isFirstChunk = false
    }
    this.push(chunk)
    callback()
  }

  _flush(callback: TransformCallback) {
    // Add Brotli footer
    this.push(Buffer.from([0x03]))
    callback()
  }
}

export async function prepareBundlePartialFiles(path: string, apikey: string, orgId: string, appid: string, encryptionMethod: 'none' | 'v2' | 'v1', finalKeyData: string) {
  const spinner = spinnerC()
  spinner.start(encryptionMethod !== 'v2' ? 'Generating the update manifest' : 'Generating the update manifest with v2 encryption')
  const manifest = await generateManifest(path)

  if (encryptionMethod === 'v2') {
    manifest.forEach((file) => {
      file.hash = encryptChecksumV2(file.hash, finalKeyData)
    })
  }

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

function convertToUnixPath(windowsPath: string): string {
  if (osPlatform() !== 'win32') {
    return windowsPath
  }
  // First, normalize the Windows path
  const normalizedPath = win32.normalize(windowsPath)

  // Convert Windows separators to POSIX separators
  return normalizedPath.split(win32.sep).join(posix.sep)
}

interface PartialEncryptionOptions {
  sessionKey: Buffer
  ivSessionKey: string
}

export async function uploadPartial(
  apikey: string,
  manifest: manifestType,
  path: string,
  appId: string,
  name: string,
  orgId: string,
  encryptionOptions: PartialEncryptionOptions | undefined,
  chunkSize: number,
): Promise<any[] | null> {
  const spinner = spinnerC()
  spinner.start('Preparing partial update with TUS protocol')
  const startTime = performance.now()
  const localConfig = await getLocalConfig()

  let uploadedFiles = 0
  const totalFiles = manifest.length

  const uploadFiles = manifest.map(async (file) => {
    const finalFilePath = join(path, file.file)
    const filePathUnix = convertToUnixPath(file.file)

    // Read file size first
    const fileStats = await readBuffer(createReadStream(finalFilePath))
    const fileStream = fileStats.length < 16
      ? createReadStream(finalFilePath).pipe(new SmallFileTransform())
      : createReadStream(finalFilePath).pipe(createBrotliCompress())
    const fileBuffer = await readBuffer(fileStream)

    let finalBuffer = fileBuffer
    if (encryptionOptions) {
      finalBuffer = encryptSourceV2(fileBuffer as Buffer, encryptionOptions.sessionKey, encryptionOptions.ivSessionKey)
    }

    return new Promise((resolve, reject) => {
      const upload = new tus.Upload(finalBuffer as any, {
        endpoint: `${localConfig.hostFilesApi}/files/upload/attachments/`,
        chunkSize,
        metadata: {
          filename: `orgs/${orgId}/apps/${appId}/${name}/${filePathUnix}`,
        },
        headers: {
          Authorization: apikey,
        },
        onError(error) {
          log.info(`Failed to upload ${filePathUnix}: ${error}`)
          reject(error)
        },
        onProgress() {
          const percentage = ((uploadedFiles / totalFiles) * 100).toFixed(2)
          spinner.message(`Uploading partial update: ${percentage}%`)
        },
        onSuccess() {
          uploadedFiles++
          resolve({
            file_name: filePathUnix,
            s3_path: `orgs/${orgId}/apps/${appId}/${name}/${filePathUnix}`,
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
