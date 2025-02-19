import type { BrotliOptions } from 'node:zlib'
import type { manifestType } from '../utils'
import { Buffer } from 'node:buffer'
import { createReadStream, statSync } from 'node:fs'
import { platform as osPlatform } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { buffer as readBuffer } from 'node:stream/consumers'
import { createBrotliCompress } from 'node:zlib'
import { log, spinner as spinnerC } from '@clack/prompts'

import * as brotli from 'brotli'
import * as tus from 'tus-js-client'
import { encryptChecksumV2, encryptSourceV2 } from '../api/cryptoV2'
import { generateManifest, getLocalConfig, sendEvent } from '../utils'

// Threshold for small files where Node.js might skip compression (in bytes)
const SMALL_FILE_THRESHOLD = 100

// Precomputed minimal Brotli stream for an empty file
const EMPTY_BROTLI_STREAM = Buffer.from([0x06]) // Final empty block, decompresses to empty buffer

// Compress file, handling all cases without failing
async function compressFile(filePath: string, options: BrotliOptions = {}): Promise<Buffer> {
  const stats = statSync(filePath)
  const fileSize = stats.size

  if (fileSize === 0) {
    return EMPTY_BROTLI_STREAM
  }

  const originalBuffer = await readBuffer(createReadStream(filePath))
  const compressedBuffer = await readBuffer(createReadStream(filePath).pipe(createBrotliCompress(options)))

  // For small files or if compression was ineffective, try brotli library
  if (fileSize < SMALL_FILE_THRESHOLD || compressedBuffer.length >= fileSize - 10) {
    const uncompressedBrotli = brotli.compress(originalBuffer, {
      mode: 0, // Generic mode
      quality: 0, // No compression, just wrap
    })
    if (uncompressedBrotli) {
      return Buffer.from(uncompressedBrotli)
    }
    // Fallback if brotli.compress fails: log warning and return zlib output or original wrapped minimally
    log.warn(`Brotli library failed for ${filePath}, falling back to minimal stream or zlib output`)
    return compressedBuffer.length > 0 ? compressedBuffer : Buffer.from([0x1B, 0x00, 0x06, ...originalBuffer, 0x03])
  }

  return compressedBuffer
}

export async function prepareBundlePartialFiles(
  path: string,
  apikey: string,
  orgId: string,
  appid: string,
  encryptionMethod: 'none' | 'v2' | 'v1',
  finalKeyData: string,
) {
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
  const normalizedPath = win32.normalize(windowsPath)
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

    const fileBuffer: Buffer = await compressFile(finalFilePath)
    let finalBuffer = fileBuffer
    if (encryptionOptions) {
      finalBuffer = encryptSourceV2(fileBuffer, encryptionOptions.sessionKey, encryptionOptions.ivSessionKey)
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
    spinner.stop(`Failed to upload Partial bundle (after ${uploadTime} seconds)`)
    log.info(`Error uploading partial update: ${error}, This is not a critical error, the bundle has been uploaded without the partial files`)
    return null
  }
}
