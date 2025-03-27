import type { manifestType } from '../utils'
import type { OptionsUpload } from './upload_interface'
import { Buffer } from 'node:buffer'
import { createReadStream, statSync } from 'node:fs'
import { platform as osPlatform } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { cwd } from 'node:process'
import { buffer as readBuffer } from 'node:stream/consumers'
import { createBrotliCompress } from 'node:zlib'
import { log, spinner as spinnerC } from '@clack/prompts'
import * as brotli from 'brotli'
import coerceVersion from 'semver/functions/coerce'
import semverSatisfies from 'semver/functions/satisfies'
import * as tus from 'tus-js-client'
import { encryptChecksumV2, encryptSourceV2 } from '../api/cryptoV2'
import { findRoot, generateManifest, getAllPackagesDependencies, getLocalConfig, PACKNAME, sendEvent } from '../utils'

// Threshold for small files where Node.js might skip compression (in bytes)
const SMALL_FILE_THRESHOLD = 4096

// Precomputed minimal Brotli stream for an empty file, compatible with iOS and Android
const EMPTY_BROTLI_STREAM = Buffer.from([0x1B, 0x00, 0x06]) // Header + final empty block

// Compress file, ensuring compatibility and no failures
async function compressFile(filePath: string, uploadOptions: OptionsUpload): Promise<{ buffer: Buffer, isCompressed: boolean }> {
  const stats = statSync(filePath)
  const fileSize = stats.size

  if (fileSize === 0) {
    return {
      buffer: EMPTY_BROTLI_STREAM,
      isCompressed: false,
    }
  }

  const originalBuffer = await readBuffer(createReadStream(filePath))
  const compressedBuffer = await readBuffer(createReadStream(filePath).pipe(createBrotliCompress({})))

  if (fileSize < SMALL_FILE_THRESHOLD || compressedBuffer.length >= fileSize - 10) {
    const uncompressedBrotli = brotli.compress(originalBuffer, {
      mode: 0, // Generic mode
      quality: 0, // No compression, just wrap
    })
    if (uncompressedBrotli) {
      return {
        buffer: Buffer.from(uncompressedBrotli),
        isCompressed: false,
      }
    }
    // Fallback if brotli.compress fails
    // will work only with > 6.14.12 or > 7.0.23
    const root = join(findRoot(cwd()), PACKNAME)
    const dependencies = await getAllPackagesDependencies(undefined, uploadOptions.packageJson || root)
    const updaterVersion = dependencies.get('@capgo/capacitor-updater')
    const coerced = coerceVersion(updaterVersion)
    if (!updaterVersion || !coerced) {
      log.warn(`Cannot find @capgo/capacitor-updater in package.json, please provide the package.json path to the command with --package-json`)
      throw new Error('Updater version not found')
    }

    if (!semverSatisfies(coerced, '>=6.14.12 <7.0.0 || >=7.0.23')) {
      log.warn(`Brotli library failed for ${filePath}, falling back to zlib output or minimal stream, this require updater 6.14.12 for Capacitor 6 or 7.0.23 for Capacitor 7`)
      throw new Error(`To use partial update, you need to upgrade @capgo/capacitor-updater to version >=6.14.12 <7.0.0 or >=7.0.23`)
    }

    if (compressedBuffer.length > 0 && compressedBuffer.length < fileSize + 10) {
      return {
        buffer: compressedBuffer, // Use zlib if it produced something reasonable
        isCompressed: false,
      }
    }
    // Last resort: minimal manual stream (shouldn't reach here often)
    return {
      buffer: Buffer.from([0x1B, 0x00, 0x06, ...originalBuffer, 0x03]),
      isCompressed: false,
    }
  }

  return {
    buffer: compressedBuffer,
    isCompressed: true,
  }
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

// Properly encode path segments while preserving slashes
function encodePathSegments(path: string): string {
  const result = path.split('/').map(segment => encodeURIComponent(segment)).join('/')
  // if has space print it
  if (path.includes(' ') || result.includes('PreviewFrame')) {
    log.warn(`File "${path}" contains spaces in its name.`)
    log.warn(`File "${result}" contains spaces in its name.`)
  }
  return result
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
  options: OptionsUpload,
): Promise<any[] | null> {
  const spinner = spinnerC()
  spinner.start('Preparing partial update with TUS protocol')
  const startTime = performance.now()
  const localConfig = await getLocalConfig()

  // Check if any files have spaces in their names
  const filesWithSpaces = manifest.filter(file => file.file.includes(' '))

  if (filesWithSpaces.length > 0) {
    throw new Error(`Files with spaces in their names (${filesWithSpaces.map(f => f.file).join(', ')}). Please rename the files.`)
  }

  let uploadedFiles = 0
  const totalFiles = manifest.length

  try {
    const uploadFiles = manifest.map(async (file) => {
      const finalFilePath = join(path, file.file)
      const filePathUnix = convertToUnixPath(file.file)

      const { buffer: fileBuffer, isCompressed } = await compressFile(finalFilePath, options)
      let finalBuffer = fileBuffer
      if (encryptionOptions) {
        finalBuffer = encryptSourceV2(fileBuffer, encryptionOptions.sessionKey, encryptionOptions.ivSessionKey)
      }
      const filePathUnixSafe = encodePathSegments(filePathUnix)
      const filePathWithExtension = isCompressed ? `${filePathUnixSafe}.br` : filePathUnixSafe
      const filename = `orgs/${orgId}/apps/${appId}/${name}/${filePathWithExtension}`

      return new Promise((resolve, reject) => {
        const upload = new tus.Upload(finalBuffer as any, {
          endpoint: `${localConfig.hostFilesApi}/files/upload/attachments/`,
          chunkSize: options.tusChunkSize,
          metadata: {
            filename,
          },
          headers: {
            Authorization: apikey,
          },
          onError(error) {
            log.info(`Failed to upload ${filePathUnixSafe}: ${error}`)
            reject(error)
          },
          onProgress() {
            const percentage = ((uploadedFiles / totalFiles) * 100).toFixed(2)
            spinner.message(`Uploading partial update: ${percentage}%`)
          },
          onSuccess() {
            uploadedFiles++
            resolve({
              file_name: filePathUnixSafe,
              s3_path: filename,
              file_hash: file.hash,
            })
          },
        })

        upload.start()
      })
    })

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
