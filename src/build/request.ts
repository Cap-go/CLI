/**
 * Native Build Request Module
 *
 * This module handles native iOS and Android build requests through Capgo's cloud build service.
 *
 * CREDENTIAL SECURITY GUARANTEE:
 * ═══════════════════════════════════════════════════════════════════════════
 * Your build credentials (certificates, keystores, passwords, API keys) are:
 *
 * ✓ NEVER stored permanently on Capgo servers
 * ✓ Used ONLY during the active build process
 * ✓ Automatically deleted from Capgo servers after build completion
 * ✓ Retained for a MAXIMUM of 24 hours (even if build fails)
 * ✓ Builds sent DIRECTLY to app stores (Apple/Google)
 * ✓ Capgo does NOT keep any build artifacts or credentials
 *
 * Credentials are transmitted securely over HTTPS and used only in ephemeral
 * build environments that are destroyed after each build completes.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * BEFORE BUILDING:
 * You must save your credentials first using:
 * - `npx @capgo/cli build credentials save --platform ios` (for iOS)
 * - `npx @capgo/cli build credentials save --platform android` (for Android)
 * - Credentials stored in ~/.capgo/credentials.json (local machine only)
 * - Use `build credentials clear` to remove saved credentials
 */

import type { OptionsBase } from '../utils'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { log } from '@clack/prompts'
import { createSupabaseClient, findSavedKey, getConfig, verifyUser } from '../utils'
import { mergeCredentials } from './credentials'

/**
 * Build credentials for iOS and Android native builds
 *
 * SECURITY: These credentials are NEVER stored on Capgo servers.
 * They are used only during the build process and are automatically
 * deleted after the build completes (maximum 24 hours retention).
 * Builds are sent directly to app stores - Capgo keeps nothing.
 */
export interface BuildCredentials {
  // iOS credentials (standard environment variable names from API)
  BUILD_CERTIFICATE_BASE64?: string
  BUILD_PROVISION_PROFILE_BASE64?: string
  BUILD_PROVISION_PROFILE_BASE64_PROD?: string
  P12_PASSWORD?: string
  APPLE_KEY_ID?: string
  APPLE_ISSUER_ID?: string
  APPLE_KEY_CONTENT?: string
  APPLE_PROFILE_NAME?: string
  APP_STORE_CONNECT_TEAM_ID?: string

  // Android credentials (standard environment variable names from API)
  ANDROID_KEYSTORE_FILE?: string
  KEYSTORE_KEY_ALIAS?: string
  KEYSTORE_KEY_PASSWORD?: string
  KEYSTORE_STORE_PASSWORD?: string
  PLAY_CONFIG_JSON?: string

  // Allow any additional environment variables
  [key: string]: string | undefined
}

/**
 * CLI options for build request command
 * All BuildCredentials fields are flattened as individual CLI options
 */
export interface BuildRequestOptions extends OptionsBase {
  path?: string
  platform: 'ios' | 'android' // Required: must be exactly "ios" or "android"
  buildMode?: 'debug' | 'release' // Build mode (default: release)
  userId?: string // User ID for the build job

  // iOS credential options (flattened from BuildCredentials)
  buildCertificateBase64?: string
  buildProvisionProfileBase64?: string
  buildProvisionProfileBase64Prod?: string
  p12Password?: string
  appleKeyId?: string
  appleIssuerId?: string
  appleKeyContent?: string
  appleProfileName?: string
  appStoreConnectTeamId?: string

  // Android credential options (flattened from BuildCredentials)
  androidKeystoreFile?: string
  keystoreKeyAlias?: string
  keystoreKeyPassword?: string
  keystoreStorePassword?: string
  playConfigJson?: string
}

export interface BuildRequestResponse {
  jobId: string
  folder: string
  status: 'queued' | 'reserved'
  artifactKey: string
  uploadUrl: string
  machine?: {
    id: string
    ip: string
    [key: string]: unknown
  } | null
}

export interface BuildRequestResult {
  success: boolean
  jobId?: string
  uploadUrl?: string
  status?: string
  error?: string
}

async function streamBuildLogs(host: string, jobId: string, appId: string, apikey: string, silent: boolean): Promise<void> {
  if (silent)
    return

  try {
    const response = await fetch(`${host}/build/logs/${jobId}?app_id=${encodeURIComponent(appId)}`, {
      headers: {
        authorization: apikey,
      },
    })

    if (!response.ok) {
      log.warn('Could not stream logs, continuing...')
      return
    }

    const reader = response.body?.getReader()
    if (!reader)
      return

    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      const text = decoder.decode(value, { stream: true })
      // SSE format: "data: message\n\n"
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const message = line.slice(6) // Remove "data: " prefix
          if (message.trim())
            log.error(message)
        }
      }
    }
  }
  catch (err) {
    // Log streaming is best-effort, don't fail the build
    if (!silent)
      log.warn(`Log streaming interrupted${err instanceof Error ? `: ${err.message}` : ''}`)
  }
}

async function pollBuildStatus(
  host: string,
  jobId: string,
  appId: string,
  platform: 'ios' | 'android',
  apikey: string,
  silent: boolean,
): Promise<string> {
  const maxAttempts = 120 // 10 minutes max (5 second intervals)
  let attempts = 0

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`${host}/build/status?job_id=${encodeURIComponent(jobId)}&app_id=${encodeURIComponent(appId)}&platform=${platform}`, {
        headers: {
          authorization: apikey,
        },
      })

      if (!response.ok) {
        if (!silent)
          log.warn(`Status check failed: ${response.status}`)
        await new Promise(resolve => setTimeout(resolve, 5000))
        attempts++
        continue
      }

      const status = await response.json() as {
        status: string
        build_time_unit?: number
        error?: string
      }

      // Terminal states
      if (status.status === 'succeeded' || status.status === 'failed') {
        return status.status
      }

      // Still running, wait and retry
      await new Promise(resolve => setTimeout(resolve, 5000))
      attempts++
    }
    catch (error) {
      if (!silent)
        log.warn(`Status check error: ${error}`)
      await new Promise(resolve => setTimeout(resolve, 5000))
      attempts++
    }
  }

  if (!silent)
    log.warn('Build status polling timed out')
  return 'timeout'
}

async function zipDirectory(projectDir: string, outputPath: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const args = ['-rq', outputPath, '.']
    const child = spawn('zip', args, { cwd: projectDir, stdio: 'inherit' })

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error('zip command not found. Please install zip utility.'))
      }
      else {
        reject(error)
      }
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
      }
      else {
        reject(new Error(`zip process exited with code ${code}`))
      }
    })
  })
}

/**
 * Request a native build from Capgo's cloud build service
 *
 * @param appId - The app ID (e.g., com.example.app)
 * @param options - Build request options including platform and credentials
 * @param silent - Suppress console output
 *
 * @returns Build request result with job ID and status
 *
 * SECURITY NOTE:
 * Credentials provided to this function are:
 * - Transmitted securely over HTTPS to Capgo's build servers
 * - Used ONLY during the active build process
 * - Automatically deleted after build completion (max 24 hours)
 * - NEVER stored permanently on Capgo servers
 * - Builds sent directly to app stores - Capgo keeps nothing
 */
export async function requestBuildInternal(appId: string, options: BuildRequestOptions, silent = false): Promise<BuildRequestResult> {
  try {
    options.apikey = options.apikey || findSavedKey(silent)
    const config = await getConfig()
    appId = appId || config?.config.appId

    if (!appId) {
      throw new Error('Missing argument, you need to provide a appId, or be in a capacitor project')
    }

    const projectDir = resolve(options.path || process.cwd())

    const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
    await verifyUser(supabase, options.apikey, ['write', 'all'])

    if (!silent) {
      log.info(`Requesting native build for ${appId}`)
      log.info(`Platform: ${options.platform}`)
      log.info(`Project: ${projectDir}`)
      log.info(`\n🔒 Security: Credentials are never stored on Capgo servers`)
      log.info(`   They are used only during build and deleted after (max 24h)`)
      log.info(`   Builds sent directly to app stores - Capgo keeps nothing\n`)
    }

    // Collect credentials from CLI args (if provided)
    const cliCredentials: Partial<BuildCredentials> = {}
    if (options.buildCertificateBase64)
      cliCredentials.BUILD_CERTIFICATE_BASE64 = options.buildCertificateBase64
    if (options.buildProvisionProfileBase64)
      cliCredentials.BUILD_PROVISION_PROFILE_BASE64 = options.buildProvisionProfileBase64
    if (options.buildProvisionProfileBase64Prod)
      cliCredentials.BUILD_PROVISION_PROFILE_BASE64_PROD = options.buildProvisionProfileBase64Prod
    if (options.p12Password)
      cliCredentials.P12_PASSWORD = options.p12Password
    if (options.appleKeyId)
      cliCredentials.APPLE_KEY_ID = options.appleKeyId
    if (options.appleIssuerId)
      cliCredentials.APPLE_ISSUER_ID = options.appleIssuerId
    if (options.appleKeyContent)
      cliCredentials.APPLE_KEY_CONTENT = options.appleKeyContent
    if (options.appleProfileName)
      cliCredentials.APPLE_PROFILE_NAME = options.appleProfileName
    if (options.appStoreConnectTeamId)
      cliCredentials.APP_STORE_CONNECT_TEAM_ID = options.appStoreConnectTeamId
    if (options.androidKeystoreFile)
      cliCredentials.ANDROID_KEYSTORE_FILE = options.androidKeystoreFile
    if (options.keystoreKeyAlias)
      cliCredentials.KEYSTORE_KEY_ALIAS = options.keystoreKeyAlias

    // For Android: if only one password is provided, use it for both key and store
    const hasKeyPassword = !!options.keystoreKeyPassword
    const hasStorePassword = !!options.keystoreStorePassword
    if (hasKeyPassword && !hasStorePassword) {
      cliCredentials.KEYSTORE_KEY_PASSWORD = options.keystoreKeyPassword
      cliCredentials.KEYSTORE_STORE_PASSWORD = options.keystoreKeyPassword
    }
    else if (!hasKeyPassword && hasStorePassword) {
      cliCredentials.KEYSTORE_KEY_PASSWORD = options.keystoreStorePassword
      cliCredentials.KEYSTORE_STORE_PASSWORD = options.keystoreStorePassword
    }
    else if (hasKeyPassword && hasStorePassword) {
      cliCredentials.KEYSTORE_KEY_PASSWORD = options.keystoreKeyPassword
      cliCredentials.KEYSTORE_STORE_PASSWORD = options.keystoreStorePassword
    }

    if (options.playConfigJson)
      cliCredentials.PLAY_CONFIG_JSON = options.playConfigJson

    // Merge credentials from all three sources:
    // 1. CLI args (highest priority)
    // 2. Environment variables (middle priority)
    // 3. Saved credentials file (lowest priority)
    const mergedCredentials = await mergeCredentials(
      appId,
      options.platform,
      Object.keys(cliCredentials).length > 0 ? cliCredentials : undefined,
    )

    // Prepare request payload for Capgo backend
    const requestPayload: {
      app_id: string
      platform: 'ios' | 'android'
      credentials?: BuildCredentials
    } = {
      app_id: appId,
      platform: options.platform,
    }

    // Validate required credentials for the platform
    if (!mergedCredentials) {
      if (!silent) {
        log.error('❌ No credentials found for this app and platform')
        log.error('')
        log.error('You must provide credentials via:')
        log.error('  1. CLI arguments (--apple-key-id, --p12-password, etc.)')
        log.error('  2. Environment variables (APPLE_KEY_ID, P12_PASSWORD, etc.)')
        log.error('  3. Saved credentials file:')
        log.error(`     npx @capgo/cli build credentials save --appId ${appId} --platform ${options.platform}`)
        log.error('')
        log.error('Documentation:')
        log.error('  https://capgo.app/docs/cli/cloud-build/credentials/')
      }
      throw new Error('No credentials found. Please provide credentials before building.')
    }

    // Validate platform-specific required credentials
    const missingCreds: string[] = []

    if (options.platform === 'ios') {
      // iOS minimum requirements
      if (!mergedCredentials.BUILD_CERTIFICATE_BASE64)
        missingCreds.push('BUILD_CERTIFICATE_BASE64 (or --build-certificate-base64)')
      if (!mergedCredentials.P12_PASSWORD)
        missingCreds.push('P12_PASSWORD (or --p12-password)')
      if (!mergedCredentials.BUILD_PROVISION_PROFILE_BASE64)
        missingCreds.push('BUILD_PROVISION_PROFILE_BASE64 (or --build-provision-profile-base64)')

      // App Store Connect API key credentials required
      if (!mergedCredentials.APPLE_KEY_ID)
        missingCreds.push('APPLE_KEY_ID (or --apple-key-id)')
      if (!mergedCredentials.APPLE_ISSUER_ID)
        missingCreds.push('APPLE_ISSUER_ID (or --apple-issuer-id)')
      if (!mergedCredentials.APPLE_KEY_CONTENT)
        missingCreds.push('APPLE_KEY_CONTENT (or --apple-key-content)')
      if (!mergedCredentials.APP_STORE_CONNECT_TEAM_ID)
        missingCreds.push('APP_STORE_CONNECT_TEAM_ID (or --apple-team-id)')
    }
    else if (options.platform === 'android') {
      // Android minimum requirements
      if (!mergedCredentials.ANDROID_KEYSTORE_FILE)
        missingCreds.push('ANDROID_KEYSTORE_FILE (or --android-keystore-file)')
      if (!mergedCredentials.KEYSTORE_KEY_ALIAS)
        missingCreds.push('KEYSTORE_KEY_ALIAS (or --keystore-key-alias)')

      // For Android, we need at least one password (will be used for both if only one provided)
      // The merging logic above handles using one password for both
      if (!mergedCredentials.KEYSTORE_KEY_PASSWORD && !mergedCredentials.KEYSTORE_STORE_PASSWORD)
        missingCreds.push('KEYSTORE_KEY_PASSWORD or KEYSTORE_STORE_PASSWORD (at least one password required)')

      // PLAY_CONFIG_JSON is optional for build, but required for upload to Play Store
      // So we warn but don't fail
      if (!mergedCredentials.PLAY_CONFIG_JSON && !silent) {
        log.warn('⚠️  PLAY_CONFIG_JSON not provided - build will succeed but cannot auto-upload to Play Store')
      }
    }

    if (missingCreds.length > 0) {
      if (!silent) {
        log.error(`❌ Missing required credentials for ${options.platform}:`)
        log.error('')
        for (const cred of missingCreds) {
          log.error(`  • ${cred}`)
        }
        log.error('')
        log.error('Provide credentials via:')
        log.error('  1. CLI arguments: npx @capgo/cli build request --platform ios --apple-id "..." --p12-password "..."')
        log.error('  2. Environment variables: export APPLE_ID="..." P12_PASSWORD="..."')
        log.error('  3. Saved credentials: npx @capgo/cli build credentials save --platform ios ...')
        log.error('')
        log.error('Documentation:')
        log.error(`  https://capgo.app/docs/cli/cloud-build/${options.platform}/`)
      }
      throw new Error(`Missing required credentials for ${options.platform}: ${missingCreds.join(', ')}`)
    }

    // Add credentials to request payload
    requestPayload.credentials = mergedCredentials
    if (!silent) {
      log.info('✓ Using credentials (merged from CLI args, env vars, and saved file)')
    }

    // Request build from Capgo backend (POST /build/request)
    if (!silent)
      log.info('Requesting build from Capgo...')

    const host = options.supaHost || 'https://api.capgo.app'
    const response = await fetch(`${host}/build/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': options.apikey,
      },
      body: JSON.stringify(requestPayload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to request build: ${response.status} - ${errorText}`)
    }

    const buildRequest = await response.json() as {
      job_id: string
      upload_url: string
      upload_expires_at: string
      status: string
    }

    if (!silent) {
      log.success(`Build job created: ${buildRequest.job_id}`)
      log.info(`Status: ${buildRequest.status}`)
    }

    // Create temporary directory for zip
    const tempDir = join(tmpdir(), `capgo-build-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    const zipPath = join(tempDir, `${basename(projectDir)}.zip`)

    try {
      // Zip the project directory
      if (!silent)
        log.info(`Zipping project from ${projectDir}...`)

      await zipDirectory(projectDir, zipPath)

      const zipStats = await stat(zipPath)
      const sizeMB = (zipStats.size / 1024 / 1024).toFixed(2)

      if (!silent)
        log.success(`Created zip: ${zipPath} (${sizeMB} MB)`)

      // Upload to presigned R2 URL
      if (!silent)
        log.info('Uploading to builder...')

      const fileBuffer = await readFile(zipPath)
      const uploadResponse = await fetch(buildRequest.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(zipStats.size),
        },
        body: fileBuffer,
      })

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text()
        throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`)
      }

      if (!silent)
        log.success('Upload complete!')

      // Start the build job via Capgo backend
      if (!silent)
        log.info('Starting build job...')

      const startResponse = await fetch(`${host}/build/start/${buildRequest.job_id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'authorization': options.apikey,
        },
        body: JSON.stringify({ app_id: appId }),
      })

      if (!startResponse.ok) {
        const errorText = await startResponse.text()
        throw new Error(`Failed to start build: ${startResponse.status} - ${errorText}`)
      }

      const startResult = await startResponse.json() as { status?: string }

      if (!silent) {
        log.success('Build started successfully!')
        log.info(`Job ID: ${buildRequest.job_id}`)
        log.info('Streaming build logs...\n')
      }

      // Stream logs from the build
      await streamBuildLogs(host, buildRequest.job_id, appId, options.apikey, silent)

      // Poll for final status
      const finalStatus = await pollBuildStatus(host, buildRequest.job_id, appId, options.platform, options.apikey, silent)

      if (!silent) {
        if (finalStatus === 'succeeded') {
          log.success(`Build completed successfully!`)
        }
        else if (finalStatus === 'failed') {
          log.error(`Build failed`)
        }
        else {
          log.warn(`Build finished with status: ${finalStatus}`)
        }
      }

      return {
        success: finalStatus === 'succeeded',
        jobId: buildRequest.job_id,
        uploadUrl: buildRequest.upload_url,
        status: finalStatus || startResult.status || buildRequest.status,
      }
    }
    finally {
      // Clean up temp directory
      await rm(tempDir, { recursive: true, force: true })
    }
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (!silent)
      log.error(errorMessage)

    return {
      success: false,
      error: errorMessage,
    }
  }
}

export async function requestBuildCommand(appId: string, options: BuildRequestOptions): Promise<void> {
  const result = await requestBuildInternal(appId, options, false)

  if (!result.success) {
    process.exit(1)
  }
}
