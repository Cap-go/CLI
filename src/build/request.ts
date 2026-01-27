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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile as readFileAsync, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { cwd, exit } from 'node:process'
import { log, spinner as spinnerC } from '@clack/prompts'
import AdmZip from 'adm-zip'
import * as tus from 'tus-js-client'
import { createSupabaseClient, findSavedKey, getConfig, getOrganizationId, sendEvent, verifyUser } from '../utils'
import { mergeCredentials } from './credentials'

/**
 * Fetch with retry logic for build requests
 * Retries failed requests with exponential backoff, logging each failure
 *
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param silent - Suppress log output
 * @returns The fetch Response if successful
 * @throws Error if all retries are exhausted
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  silent = false,
): Promise<Response> {
  const retryDelays = [1000, 3000, 5000] // 1s, 3s, 5s delays between retries

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options)

      // If response is OK or it's a client error (4xx), don't retry
      // Only retry on server errors (5xx) or network failures
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response
      }

      // Server error (5xx) - log and retry
      const errorText = await response.text().catch(() => 'unknown error')
      if (!silent) {
        log.warn(`Build request attempt ${attempt}/${maxRetries} failed: ${response.status} - ${errorText}`)
      }

      if (attempt < maxRetries) {
        const delay = retryDelays[attempt - 1] || 5000
        if (!silent) {
          log.info(`Retrying in ${delay / 1000}s...`)
        }
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      else {
        // Last attempt failed, throw error
        throw new Error(`Failed to request build after ${maxRetries} attempts: ${response.status} - ${errorText}`)
      }
    }
    catch (error) {
      // Network error or other fetch failure
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Don't retry if we already threw our own error
      if (errorMessage.startsWith('Failed to request build after')) {
        throw error
      }

      if (!silent) {
        log.warn(`Build request attempt ${attempt}/${maxRetries} failed: ${errorMessage}`)
      }

      if (attempt < maxRetries) {
        const delay = retryDelays[attempt - 1] || 5000
        if (!silent) {
          log.info(`Retrying in ${delay / 1000}s...`)
        }
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      else {
        throw new Error(`Failed to request build after ${maxRetries} attempts: ${errorMessage}`)
      }
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new Error('Unexpected error in fetchWithRetry')
}

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

  // Output control options
  verbose?: boolean // Enable verbose output with detailed logging
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

/**
 * Read with timeout - wraps reader.read() with a timeout
 * Returns the read result or throws on timeout
 */
function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<{ done: boolean, value?: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Read timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    reader.read().then(
      (result) => {
        clearTimeout(timeoutId)
        resolve(result)
      },
      (err) => {
        clearTimeout(timeoutId)
        reject(err)
      },
    )
  })
}

/**
 * Stream build logs from the server via direct SSE
 * Returns the final status if detected from the stream, or null if stream ended without status
 * Note: Build cancellation on disconnect is handled by the builder worker
 *
 * @param silent - If true, don't output any logs
 * @param _verbose - Verbose logging (currently unused)
 * @param directLogsUrl - Direct URL to CF Worker for SSE streaming
 * @param directLogsToken - JWT token for direct SSE authentication
 */
async function streamBuildLogs(
  silent: boolean,
  _verbose = false,
  directLogsUrl?: string,
  directLogsToken?: string,
): Promise<string | null> {
  if (silent)
    return null

  if (!directLogsUrl || !directLogsToken) {
    log.warn('Missing logs_url or logs_token; direct log streaming is unavailable')
    return null
  }

  let finalStatus: string | null = null
  let hasReceivedLogs = false
  let lastSequence = -1
  let reconnectAttempts = 0
  const maxReconnectAttempts = 10
  const readTimeoutMs = 30000 // 30 seconds - if no data for 30s, reconnect
  const reconnectDelayMs = 2000 // 2 seconds between reconnect attempts

  // Helper to process and display a log message
  const processLogMessage = (message: string): boolean => {
    if (!message.trim())
      return false

    // Check for final status messages from the server
    // Server sends "Build succeeded", "Build failed", "Job already succeeded", etc.
    const statusMatch = message.match(/^(?:Build|Job already) (succeeded|failed|expired|released|cancelled)$/i)
    if (statusMatch) {
      finalStatus = statusMatch[1].toLowerCase()
      // Don't display status messages as log lines - they'll be displayed as final status
      return true // Signal that we got final status
    }

    // Don't display logs after we've received a final status (e.g., cleanup messages after failure)
    if (finalStatus)
      return false

    // Print log line directly to console (no spinner to avoid _events errors)
    if (!hasReceivedLogs) {
      hasReceivedLogs = true
      log.info('') // Add blank line before first log
    }
    log.info(message)
    return false
  }

  while (reconnectAttempts < maxReconnectAttempts) {
    if (finalStatus) {
      break
    }
    // Direct SSE: Connect directly to CF Worker with JWT token
    let logUrl = `${directLogsUrl}?token=${encodeURIComponent(directLogsToken)}`
    if (lastSequence >= 0) {
      logUrl += `&last_sequence=${lastSequence}`
    }

    if (reconnectAttempts === 0) {
      log.info('Connecting to log stream...')
    }
    else {
      log.info(`Reconnecting to log stream (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})...`)
    }

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

    try {
      const response = await fetch(logUrl)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown error')

        // If we get 404, the job might be done - don't retry
        if (response.status === 404) {
          log.warn(`Log stream not found (job may have completed)`)
          return null
        }
        if (response.status === 401 || response.status === 403) {
          log.warn(`Log stream authorization failed (${response.status})`)
          return null
        }
        log.warn(`Could not stream logs (${response.status}): ${errorText}`)
        reconnectAttempts++
        await new Promise(resolve => setTimeout(resolve, reconnectDelayMs))
        continue
      }

      reader = response.body?.getReader() ?? null
      if (!reader) {
        log.warn('No response body for log stream')
        reconnectAttempts++
        await new Promise(resolve => setTimeout(resolve, reconnectDelayMs))
        continue
      }

      // Successfully connected - reset reconnect attempts
      reconnectAttempts = 0

      const decoder = new TextDecoder()
      let buffer = '' // Buffer for incomplete lines

      while (true) {
        // Use timeout to detect stale connections quickly
        const { done, value } = await readWithTimeout(reader, readTimeoutMs)
        if (done) {
          // Stream ended normally
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines (SSE format: "data: message\n\n" or "id: N\ndata: message\n\n")
        const lines = buffer.split('\n')
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || ''

        for (const line of lines) {
          // Track sequence ID if present (for resumption)
          if (line.startsWith('id: ')) {
            const seqStr = line.slice(4).trim()
            const seq = Number.parseInt(seqStr, 10)
            if (!Number.isNaN(seq)) {
              lastSequence = seq
            }
          }
          // Process data lines
          else if (line.startsWith('data: ')) {
            const message = line.slice(6) // Remove "data: " prefix
            const gotFinalStatus = processLogMessage(message)
            if (gotFinalStatus) {
              // Got final status, we're done
              reader.cancel().catch(() => {})
              return finalStatus
            }
          }
          // Ignore keepalive comments (lines starting with :)
        }
      }

      // Process any remaining data in buffer
      if (buffer.startsWith('data: ')) {
        const message = buffer.slice(6)
        processLogMessage(message)
      }

      // Stream ended normally - if we have final status, return it
      if (finalStatus) {
        return finalStatus
      }

      // Stream ended without final status - might need to reconnect
      // But first check if this was a clean close (job might be done)
      log.info('Log stream ended, checking if more data available...')
      reconnectAttempts++
      await new Promise(resolve => setTimeout(resolve, reconnectDelayMs))
    }
    catch (err) {
      // Clean up reader if it exists
      if (reader) {
        reader.cancel().catch(() => {})
      }

      const errorMessage = err instanceof Error ? err.message : String(err)

      // Timeout errors are expected when connection goes stale - reconnect silently
      if (errorMessage.includes('timeout')) {
        log.info('Log stream stale, reconnecting...')
      }
      else {
        log.warn(`Log streaming interrupted: ${errorMessage}`)
      }

      reconnectAttempts++

      // Don't wait before reconnecting on timeout (connection is already dead)
      if (!errorMessage.includes('timeout')) {
        await new Promise(resolve => setTimeout(resolve, reconnectDelayMs))
      }
    }
  }

  if (reconnectAttempts >= maxReconnectAttempts) {
    log.warn(`Log streaming failed after ${maxReconnectAttempts} reconnection attempts`)
  }

  return finalStatus
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
        build_time_seconds?: number | null
        error?: string | null
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

/**
 * Extract native node_modules dependencies from iOS Podfile or Android settings.gradle
 * Returns paths to ONLY the platform-specific subfolder (e.g., node_modules/@capacitor/app/ios)
 */
interface NativeDependencies {
  packages: Set<string> // Package paths like @capacitor/app
  usesSPM: boolean // true = SPM (Package.swift), false = CocoaPods (podspec)
}

async function extractNativeDependencies(projectDir: string, platform: 'ios' | 'android'): Promise<NativeDependencies> {
  const packages = new Set<string>()
  let usesSPM = false

  if (platform === 'ios') {
    // Check for Swift Package Manager first (Capacitor 7+)
    // SPM takes precedence over CocoaPods
    const spmPackagePath = join(projectDir, 'ios/App/CapApp-SPM/Package.swift')
    if (existsSync(spmPackagePath)) {
      usesSPM = true
      const spmContent = await readFileAsync(spmPackagePath, 'utf-8')
      // Match lines like: .package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app")
      // The path can have varying numbers of ../ depending on project structure
      const spmMatches = spmContent.matchAll(/\.package\s*\([^)]*path:\s*["'](?:\.\.\/)*node_modules\/([^"']+)["']\s*\)/g)
      for (const match of spmMatches) {
        packages.add(match[1])
      }
    }
    else {
      // Fall back to CocoaPods (legacy, pre-Capacitor 7)
      const podfilePath = join(projectDir, 'ios/App/Podfile')
      if (existsSync(podfilePath)) {
        const podfileContent = await readFileAsync(podfilePath, 'utf-8')
        // Match lines like: pod 'CapacitorApp', :path => '../../node_modules/@capacitor/app'
        const podMatches = podfileContent.matchAll(/pod\s+['"][^'"]+['"],\s*:path\s*=>\s*['"]\.\.\/\.\.\/node_modules\/([^'"]+)['"]/g)
        for (const match of podMatches) {
          packages.add(match[1])
        }
      }
    }
  }
  else if (platform === 'android') {
    // Parse Android capacitor.settings.gradle
    const settingsGradlePath = join(projectDir, 'android/capacitor.settings.gradle')
    if (existsSync(settingsGradlePath)) {
      const settingsContent = await readFileAsync(settingsGradlePath, 'utf-8')
      // Match lines like: project(':capacitor-app').projectDir = new File('../node_modules/@capacitor/app/android')
      const gradleMatches = settingsContent.matchAll(/new\s+File\s*\(\s*['"]\.\.\/node_modules\/([^'"]+)['"]\s*\)/g)
      for (const match of gradleMatches) {
        // Extract the full path which already includes /android
        const fullPath = match[1]
        const packagePath = fullPath.replace(/\/android$/, '')
        packages.add(packagePath)
      }
    }
  }

  return { packages, usesSPM }
}

/**
 * Check if a file path should be included in the zip
 */
function shouldIncludeFile(filePath: string, platform: 'ios' | 'android', nativeDeps: NativeDependencies): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/')

  // Always include platform folder
  if (normalizedPath.startsWith(`${platform}/`))
    return true

  // Always include config files at root
  if (normalizedPath === 'package.json' || normalizedPath === 'package-lock.json' || normalizedPath.startsWith('capacitor.config.'))
    return true

  // Include resources folder
  if (normalizedPath.startsWith('resources/'))
    return true

  // Include @capacitor core for the platform
  if (platform === 'ios' && normalizedPath.startsWith('node_modules/@capacitor/ios/'))
    return true
  if (platform === 'android' && normalizedPath.startsWith('node_modules/@capacitor/android/'))
    return true

  // Check if file is in one of the native dependencies
  for (const packagePath of nativeDeps.packages) {
    const packagePrefix = `node_modules/${packagePath}/`

    if (platform === 'android') {
      // For Android, only include the android/ subfolder
      if (normalizedPath.startsWith(`${packagePrefix}android/`))
        return true
    }
    else if (platform === 'ios') {
      // For iOS, include ios/ folder and either Package.swift (SPM) or *.podspec (CocoaPods)
      if (normalizedPath.startsWith(`${packagePrefix}ios/`))
        return true

      if (nativeDeps.usesSPM) {
        // SPM: include Package.swift
        if (normalizedPath === `${packagePrefix}Package.swift`)
          return true
      }
      else {
        // CocoaPods: include *.podspec files
        if (normalizedPath.startsWith(packagePrefix) && normalizedPath.endsWith('.podspec'))
          return true
      }
    }
  }

  return false
}

/**
 * Recursively add directory to zip with filtering
 */
function addDirectoryToZip(zip: AdmZip, dirPath: string, zipPath: string, platform: 'ios' | 'android', nativeDeps: NativeDependencies) {
  const items = readdirSync(dirPath)

  for (const item of items) {
    const itemPath = join(dirPath, item)
    const itemZipPath = zipPath ? `${zipPath}/${item}` : item
    const stats = statSync(itemPath)

    if (stats.isDirectory()) {
      // Skip excluded directories
      // .git: version control
      // dist, build, .angular, .vite: build output directories
      // .gradle, .idea: Android build cache and IDE settings
      // .swiftpm: Swift Package Manager cache
      if (item === '.git' || item === 'dist' || item === 'build' || item === '.angular' || item === '.vite' || item === '.gradle' || item === '.idea' || item === '.swiftpm')
        continue

      // Always recurse into the platform folder (ios/ or android/)
      if (item === platform) {
        addDirectoryToZip(zip, itemPath, itemZipPath, platform, nativeDeps)
        continue
      }

      // Always recurse into node_modules (we filter inside)
      if (item === 'node_modules') {
        addDirectoryToZip(zip, itemPath, itemZipPath, platform, nativeDeps)
        continue
      }

      // For resources folder, always recurse
      if (item === 'resources') {
        addDirectoryToZip(zip, itemPath, itemZipPath, platform, nativeDeps)
        continue
      }

      // For other directories, check if we need to recurse into them
      // We should recurse if:
      // 1. This directory itself should be included (matches a pattern)
      // 2. This directory is a prefix of a dependency path (need to traverse to reach it)
      const normalizedItemPath = itemZipPath.replace(/\\/g, '/')
      const shouldRecurse = shouldIncludeFile(itemZipPath, platform, nativeDeps)
        || Array.from(nativeDeps.packages).some((pkg) => {
          const depPath = `node_modules/${pkg}/`
          return depPath.startsWith(`${normalizedItemPath}/`) || normalizedItemPath.startsWith(`node_modules/${pkg}`)
        })

      if (shouldRecurse) {
        addDirectoryToZip(zip, itemPath, itemZipPath, platform, nativeDeps)
      }
    }
    else if (stats.isFile()) {
      // Skip excluded files
      if (item === '.DS_Store' || item.endsWith('.log'))
        continue

      // Check if we should include this file
      if (shouldIncludeFile(itemZipPath, platform, nativeDeps)) {
        zip.addLocalFile(itemPath, zipPath || undefined)
      }
    }
  }
}

/**
 * Zip directory for native build, including only necessary files:
 * - ios/ OR android/ folder (based on platform)
 * - node_modules with native code (from Podfile/settings.gradle)
 * - capacitor.config.*, package.json, package-lock.json
 */
async function zipDirectory(projectDir: string, outputPath: string, platform: 'ios' | 'android'): Promise<void> {
  // Extract which node_modules have native code for this platform
  const nativeDeps = await extractNativeDependencies(projectDir, platform)

  const zip = new AdmZip()

  // Add files with filtering
  addDirectoryToZip(zip, projectDir, '', platform, nativeDeps)

  // Write zip to file
  await writeFile(outputPath, zip.toBuffer())
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
 * - Automatically deleted after build completion
 * - NEVER stored permanently on Capgo servers
 * - Builds sent directly to app stores - Capgo keeps nothing
 */
export async function requestBuildInternal(appId: string, options: BuildRequestOptions, silent = false): Promise<BuildRequestResult> {
  // Track build time
  const buildStartTime = Date.now()
  const verbose = options.verbose ?? false

  try {
    options.apikey = options.apikey || findSavedKey(silent)
    const config = await getConfig()
    appId = appId || config?.config.appId

    if (!appId) {
      throw new Error('Missing argument, you need to provide a appId, or be in a capacitor project')
    }

    if (!options.platform) {
      throw new Error('Missing required argument: --platform <ios|android>')
    }

    if (options.platform !== 'ios' && options.platform !== 'android') {
      throw new Error(`Invalid platform "${options.platform}". Must be "ios" or "android"`)
    }

    const projectDir = resolve(options.path || cwd())
    const host = options.supaHost || 'https://api.capgo.app'

    const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
    await verifyUser(supabase, options.apikey, ['write', 'all'])

    // Get organization ID for analytics
    const orgId = await getOrganizationId(supabase, appId)

    if (!silent) {
      log.info(`Requesting native build for ${appId}`)
      log.info(`Platform: ${options.platform}`)
      log.info(`Project: ${projectDir}`)
      log.info(`\n🔒 Security: Credentials are never stored on Capgo servers`)
      log.info(`   They are used only during build and deleted after`)
      log.info(`   Builds sent directly to app stores - Capgo keeps nothing\n`)
    }
    if (verbose) {
      log.info(`API host: ${host}`)
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
      build_mode?: 'debug' | 'release'
      credentials?: BuildCredentials
    } = {
      app_id: appId,
      platform: options.platform,
      build_mode: options.buildMode,
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
      // Note: P12_PASSWORD is optional - certificates can have no password
      // But we warn if it's missing in case the user forgot
      if (!mergedCredentials.P12_PASSWORD && !silent) {
        log.warn('⚠️  P12_PASSWORD not provided - assuming certificate has no password')
        log.warn('   If your certificate requires a password, provide it with --p12-password')
      }
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
    if (verbose) {
      const credentialKeys = Object.keys(mergedCredentials).filter(k => mergedCredentials[k])
      log.info(`Credentials provided: ${credentialKeys.join(', ')}`)
    }

    // Request build from Capgo backend (POST /build/request)
    if (!silent)
      log.info('Requesting build from Capgo...')

    const maxRetries = 3
    const response = await fetchWithRetry(
      `${host}/build/request`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'authorization': options.apikey,
        },
        body: JSON.stringify(requestPayload),
      },
      maxRetries,
      silent,
    )

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
    if (verbose) {
      log.info(`Upload URL: ${buildRequest.upload_url}`)
      log.info(`Upload expires: ${buildRequest.upload_expires_at}`)
    }

    // Send analytics event for build request
    await sendEvent(options.apikey, {
      channel: 'native-builder',
      event: 'Build requested',
      icon: '🏗️',
      user_id: orgId,
      tags: {
        'app-id': appId,
        'platform': options.platform,
      },
      notify: false,
    }).catch()

    // Create temporary directory for zip
    const tempDir = join(tmpdir(), `capgo-build-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    const zipPath = join(tempDir, `${basename(projectDir)}.zip`)

    try {
      // Zip the project directory
      if (!silent)
        log.info(`Zipping ${options.platform} project from ${projectDir}...`)

      await zipDirectory(projectDir, zipPath, options.platform)

      const zipStats = await stat(zipPath)
      const sizeMB = (zipStats.size / 1024 / 1024).toFixed(2)

      if (!silent)
        log.success(`Created zip: ${zipPath} (${sizeMB} MB)`)

      // Upload to builder using TUS protocol
      if (!silent) {
        log.info('Uploading to builder...')
      }
      if (verbose) {
        log.info(`Upload endpoint: ${buildRequest.upload_url}`)
        log.info(`File size: ${sizeMB} MB`)
        log.info(`Job ID: ${buildRequest.job_id}`)
      }

      // Read zip file into buffer for TUS upload
      const zipBuffer = readFileSync(zipPath)

      // Upload using TUS protocol
      const spinner = spinnerC()
      if (!silent)
        spinner.start('Uploading bundle')

      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(zipBuffer as any, {
          endpoint: buildRequest.upload_url,
          chunkSize: 5 * 1024 * 1024, // 5MB chunks
          metadata: {
            filename: basename(zipPath),
            filetype: 'application/zip',
          },
          headers: {
            authorization: options.apikey,
          },
          // Callback before request is sent
          onBeforeRequest(req) {
            if (verbose) {
              log.info(`[TUS] ${req.getMethod()} ${req.getURL()}`)
              const authHeader = req.getHeader('authorization')
              log.info(`[TUS] Authorization header present: ${!!authHeader}`)
            }
          },
          // Callback after response is received
          onAfterResponse(_req, res) {
            if (verbose) {
              log.info(`[TUS] Response status: ${res.getStatus()}`)
              const uploadOffset = res.getHeader('upload-offset')
              const tusResumable = res.getHeader('tus-resumable')
              log.info(`[TUS] Upload-Offset: ${uploadOffset}, Tus-Resumable: ${tusResumable}`)
            }
          },
          // Callback for errors which cannot be fixed using retries
          onError(error) {
            if (!silent) {
              spinner.stop('Upload failed')
              log.error(`Upload error: ${error.message}`)
            }
            if (error instanceof tus.DetailedError) {
              const body = error.originalResponse?.getBody()
              const status = error.originalResponse?.getStatus()
              const url = error.originalRequest?.getURL()

              if (verbose) {
                log.error(`[TUS] Request URL: ${url}`)
                log.error(`[TUS] Response status: ${status}`)
                log.error(`[TUS] Response body: ${body}`)
              }

              let errorMsg = 'Unknown error'
              try {
                const jsonBody = JSON.parse(body || '{"error": "unknown error"}')
                errorMsg = jsonBody.status || jsonBody.error || jsonBody.message || 'unknown error'
              }
              catch {
                errorMsg = body || error.message
              }
              reject(new Error(`TUS upload failed: ${errorMsg}`))
            }
            else {
              reject(new Error(`TUS upload failed: ${error.message || error.toString()}`))
            }
          },
          // Callback for reporting upload progress
          onProgress(bytesUploaded, bytesTotal) {
            const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2)
            if (!silent)
              spinner.message(`Uploading ${percentage}%`)
          },
          // Callback for once the upload is completed
          onSuccess() {
            if (!silent) {
              spinner.stop('Upload complete!')
            }
            if (verbose) {
              log.success('TUS upload completed successfully')
            }
            resolve()
          },
        })

        // Start the upload
        if (verbose)
          log.info('[TUS] Starting upload...')
        upload.start()
      })

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

      const startResult = await startResponse.json() as {
        status?: string
        logs_url?: string
        logs_token?: string
      }

      if (!silent) {
        log.success('Build started!')
        log.info('Streaming build logs...')
      }

      let finalStatus: string
      // Stream logs from the build - returns final status if detected from stream
      const streamStatus = await streamBuildLogs(
        silent,
        verbose,
        startResult.logs_url,
        startResult.logs_token,
      )

      // Only poll if we didn't get the final status from the stream
      if (streamStatus) {
        finalStatus = streamStatus
      }
      else {
        // Fall back to polling if stream ended without final status
        finalStatus = await pollBuildStatus(host, buildRequest.job_id, appId, options.platform, options.apikey, silent)
      }

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

      // Calculate build time (in seconds with 2 decimal places, matching upload behavior)
      const buildTime = ((Date.now() - buildStartTime) / 1000).toFixed(2)

      // Send analytics event for build result (includes build time)
      await sendEvent(options.apikey, {
        channel: 'native-builder',
        event: finalStatus === 'succeeded' ? 'Build succeeded' : 'Build failed',
        icon: finalStatus === 'succeeded' ? '✅' : '❌',
        user_id: orgId,
        tags: {
          'app-id': appId,
          'platform': options.platform,
          'status': finalStatus || 'unknown',
          'time': buildTime,
        },
        notify: false,
      }).catch()

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
    exit(1)
  }
}
