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
  APPLE_ID?: string
  APPLE_APP_SPECIFIC_PASSWORD?: string
  APPLE_KEY_ID?: string
  APPLE_ISSUER_ID?: string
  APPLE_KEY_CONTENT?: string
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

export interface BuildRequestOptions extends OptionsBase {
  path?: string
  platform: 'ios' | 'android' // Required: must be exactly "ios" or "android"
  buildMode?: 'debug' | 'release' // Build mode (default: release)
  credentials?: BuildCredentials
  userId?: string // User ID for the build job
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

    // Merge saved credentials with provided credentials
    // Provided credentials take precedence over saved ones
    const mergedCredentials = await mergeCredentials(appId, options.platform, options.credentials)

    // Prepare request payload for Capgo backend
    const requestPayload: {
      app_id: string
      platform: 'ios' | 'android'
      credentials?: BuildCredentials
    } = {
      app_id: appId,
      platform: options.platform,
    }

    // Add credentials if available (either saved or provided)
    if (mergedCredentials) {
      requestPayload.credentials = mergedCredentials
      if (!silent) {
        log.info('✓ Using credentials (saved + provided)')
      }
    }
    else {
      // No credentials found - fail early with helpful message
      if (!silent) {
        log.error('❌ No credentials found for this app and platform')
        log.error('')
        log.error('You must save credentials before building:')
        log.error(`  npx @capgo/cli build credentials save --appId ${appId} --platform ${options.platform}`)
        log.error('')
        log.error('Documentation:')
        log.error('  https://capgo.app/docs/cli/cloud-build/credentials/#saving-ios-credentials')
        log.error('  https://capgo.app/docs/cli/cloud-build/credentials/#saving-android-credentials')
      }
      throw new Error('No credentials found. Please save credentials before building.')
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
