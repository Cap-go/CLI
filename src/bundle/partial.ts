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
// TODO: remove deprecated brotli when all user are on latest Node.js
import * as brotli from 'brotli'
// @ts-expect-error - No type definitions available for micromatch
import * as micromatch from 'micromatch'
import coerceVersion from 'semver/functions/coerce'
import semverGte from 'semver/functions/gte'
import semverSatisfies from 'semver/functions/satisfies'
import * as tus from 'tus-js-client'
import { encryptChecksumV2, encryptSourceV2 } from '../api/cryptoV2'
import { findRoot, generateManifest, getAllPackagesDependencies, getLocalConfig, PACKNAME, sendEvent } from '../utils'

// Check if file already exists on server
async function fileExists(localConfig: any, filename: string): Promise<boolean> {
  try {
    const response = await fetch(`${localConfig.hostFilesApi}/files/read/attachments/${encodeURIComponent(filename)}`, {
      method: 'HEAD',
    })
    return response.ok
  }
  catch {
    return false
  }
}

// Threshold for small files where Node.js might skip compression (in bytes)
const SMALL_FILE_THRESHOLD = 4096

// Minimum size for Brotli compression according to RFC
// Files smaller than this won't be compressed with Brotli
const BROTLI_MIN_SIZE = 8192

// Version required for Brotli support with .br extension
const BROTLI_MIN_UPDATER_VERSION = '7.0.37'

// Precomputed minimal Brotli stream for an empty file, compatible with iOS and Android
const EMPTY_BROTLI_STREAM = Buffer.from([0x1B, 0x00, 0x06]) // Header + final empty block

// Check if the updater version supports .br extension
async function getUpdaterVersion(uploadOptions: OptionsUpload): Promise<{ version: string | null, supportsBrotliV2: boolean }> {
  const root = join(findRoot(cwd()), PACKNAME)
  const dependencies = await getAllPackagesDependencies(undefined, uploadOptions.packageJson || root)
  const updaterVersion = dependencies.get('@capgo/capacitor-updater')
  const coerced = coerceVersion(updaterVersion)

  if (!updaterVersion || !coerced)
    return { version: null, supportsBrotliV2: false }

  // Brotli is only supported in updater versions >= 7.0.37
  const supportsBrotliV2 = semverGte(coerced.version, BROTLI_MIN_UPDATER_VERSION)
  return { version: coerced.version, supportsBrotliV2 }
}

// Check if a file should be excluded from brotli compression
function shouldExcludeFromBrotli(filePath: string, noBrotliPatterns?: string): boolean {
  if (!noBrotliPatterns) {
    return false
  }

  const patterns = noBrotliPatterns.split(',').map(p => p.trim()).filter(p => !!p)
  if (patterns.length === 0) {
    return false
  }

  return micromatch.isMatch(filePath, patterns)
}

// Compress file, ensuring compatibility and no failures
// Legacy function for backward compatibility (updater < 7.0.37)
// DO NOT MODIFY THIS FUNCTION to maintain backward compatibility
async function compressFileLegacy(filePath: string, uploadOptions: OptionsUpload): Promise<Buffer> {
  const stats = statSync(filePath)
  const fileSize = stats.size

  if (fileSize === 0) {
    return EMPTY_BROTLI_STREAM
  }

  const originalBuffer = await readBuffer(createReadStream(filePath))
  const compressedBuffer = await readBuffer(createReadStream(filePath).pipe(createBrotliCompress({})))

  // For small files or ineffective compression, use brotli library
  if (fileSize < SMALL_FILE_THRESHOLD || compressedBuffer.length >= fileSize - 10) {
    const uncompressedBrotli = brotli.compress(originalBuffer, {
      mode: 0, // Generic mode
      quality: 0, // No compression, just wrap
    })
    if (uncompressedBrotli) {
      return Buffer.from(uncompressedBrotli)
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
      return compressedBuffer // Use zlib if it produced something reasonable
    }
    // Last resort: minimal manual stream (shouldn't reach here often)
    return Buffer.from([0x1B, 0x00, 0x06, ...originalBuffer, 0x03])
  }

  return compressedBuffer
}

// Function to determine if a file should use Brotli compression (for version >= 7.0.37)
async function shouldUseBrotli(
  filePath: string,
  filePathUnix: string,
  options: OptionsUpload,
): Promise<{ buffer: Buffer, useBrotli: boolean }> {
  const stats = statSync(filePath)
  const fileSize = stats.size
  const originalBuffer = await readBuffer(createReadStream(filePath))

  if (fileSize === 0) {
    // Empty files - just return the original content (which is empty)
    return { buffer: originalBuffer, useBrotli: false }
  }

  // Skip brotli if file matches exclusion patterns
  if (shouldExcludeFromBrotli(filePathUnix, options.noBrotliPatterns)) {
    log.info(`Skipping brotli for excluded file: ${filePathUnix}`)
    // Don't compress excluded files - just return the original content
    return { buffer: originalBuffer, useBrotli: false }
  }

  // Skip brotli for files smaller than RFC minimum size
  if (fileSize < BROTLI_MIN_SIZE) {
    // Don't compress small files - just return the original content
    return { buffer: originalBuffer, useBrotli: false }
  }

  try {
    // Try Brotli compression
    const compressedBuffer = await readBuffer(createReadStream(filePath).pipe(createBrotliCompress({})))

    // If compression isn't effective, don't use Brotli and don't compress
    if (compressedBuffer.length >= fileSize - 10) {
      log.info(`Brotli not effective for ${filePathUnix} (${fileSize} bytes), using original file`)
      return { buffer: originalBuffer, useBrotli: false }
    }

    // Brotli compression worked well
    return { buffer: compressedBuffer, useBrotli: true }
  }
  catch (error) {
    log.warn(`Brotli compression failed for ${filePath}: ${error}, using original file`)
    return { buffer: originalBuffer, useBrotli: false }
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
    for (const file of manifest) {
      file.hash = encryptChecksumV2(file.hash, finalKeyData)
    }
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
  if (path.includes(' ')) {
    log.warn(`File "${path}" contains spaces in its name.`)
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
  bundleName: string,
  orgId: string,
  encryptionOptions: PartialEncryptionOptions | undefined,
  options: OptionsUpload,
): Promise<any[] | null> {
  const spinner = spinnerC()
  spinner.start('Preparing partial update with TUS protocol')
  const startTime = performance.now()
  const localConfig = await getLocalConfig()

  // Check the updater version and Brotli support
  const { version, supportsBrotliV2 } = await getUpdaterVersion(options)

  // Check for incompatible options with older updater versions
  if (!supportsBrotliV2) {
    // Always warn about options that have no effect with older versions
    if (options.disableBrotli) {
      log.warn(`--disable-brotli option has no effect with updater version ${version || 'unknown'} (requires ${BROTLI_MIN_UPDATER_VERSION}+)`)
    }

    if (options.noBrotliPatterns) {
      throw new Error(`--no-brotli-patterns option requires updater version ${BROTLI_MIN_UPDATER_VERSION} or higher, but you have ${version || 'unknown'}`)
    }

    log.info(`Using legacy compression (updater ${version || 'unknown'} < ${BROTLI_MIN_UPDATER_VERSION})`)
  }
  else {
    // Only newer versions can use Brotli with .br extension
    if (options.disableBrotli) {
      log.info('Brotli compression disabled by user request')
    }
    else {
      spinner.message(`Using .br extension for compatible files (updater ${version} >= ${BROTLI_MIN_UPDATER_VERSION})`)
      if (options.noBrotliPatterns) {
        log.info(`Files matching patterns (${options.noBrotliPatterns}) will be excluded from brotli compression`)
      }
      log.info(`Files smaller than ${BROTLI_MIN_SIZE} bytes will be excluded from brotli compression (Brotli RFC minimum)`)
    }
  }

  // Check if any files have spaces in their names
  const filesWithSpaces = manifest.filter(file => file.file.includes(' '))

  if (filesWithSpaces.length > 0) {
    throw new Error(`Files with spaces in their names (${filesWithSpaces.map(f => f.file).join(', ')}). Please rename the files.`)
  }

  let uploadedFiles = 0
  const totalFiles = manifest.length
  let brFilesCount = 0

  try {
    const uploadFiles = manifest.map(async (file) => {
      const finalFilePath = join(path, file.file)
      const filePathUnix = convertToUnixPath(file.file)

      let fileBuffer: Buffer
      let isBrotli = false

      // Version check is the primary decision point - no option to override legacy for older versions
      if (!supportsBrotliV2) {
        // For versions < 7.0.37, ALWAYS use legacy compression
        fileBuffer = await compressFileLegacy(finalFilePath, options)
      }
      else {
        // For versions >= 7.0.37, allow user options
        if (options.disableBrotli) {
          // User explicitly disabled Brotli, don't compress at all
          fileBuffer = await readBuffer(createReadStream(finalFilePath))
          isBrotli = false
        }
        else {
          // Normal case: use Brotli when appropriate
          const result = await shouldUseBrotli(finalFilePath, filePathUnix, options)
          fileBuffer = result.buffer
          isBrotli = result.useBrotli
        }
      }

      let finalBuffer = fileBuffer
      if (encryptionOptions) {
        finalBuffer = encryptSourceV2(fileBuffer, encryptionOptions.sessionKey, encryptionOptions.ivSessionKey)
      }

      // Determine the upload path (with or without .br extension)
      let uploadPathUnix = filePathUnix
      // Only add .br extension if file was actually compressed with brotli
      if (isBrotli) {
        uploadPathUnix = `${filePathUnix}.br`
        brFilesCount++
      }

      const filePathUnixSafe = encodePathSegments(uploadPathUnix)
      const filename = `orgs/${orgId}/apps/${appId}/delta/${file.hash}_${filePathUnixSafe}`

      // Check if file already exists
      if (await fileExists(localConfig, filename)) {
        uploadedFiles++
        return Promise.resolve({
          file_name: filePathUnixSafe,
          s3_path: filename,
          file_hash: file.hash,
        })
      }

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

    if (brFilesCount > 0) {
      log.info(`${brFilesCount} of ${totalFiles} files were compressed with brotli and use .br extension`)
    }

    await sendEvent(apikey, {
      channel: 'app',
      event: `App Partial TUS done${brFilesCount > 0 ? ' with .br extension' : ''}`,
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
