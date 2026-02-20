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
 * ✓ Build outputs may optionally be uploaded for time-limited download links
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

import type { BuildCredentials, BuildRequestOptions, BuildRequestResult } from '../schemas/build'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile as readFileAsync, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import process, { chdir, cwd, exit } from 'node:process'
import { log, spinner as spinnerC } from '@clack/prompts'
import AdmZip from 'adm-zip'
import { WebSocket as PartySocket } from 'partysocket'
import * as tus from 'tus-js-client'
import WS from 'ws' // TODO: remove when min version nodejs 22 is bump, should do it in july 2026 as it become deprecated
import pack from '../../package.json'
import { createSupabaseClient, findSavedKey, getConfig, getOrganizationId, sendEvent, verifyUser } from '../utils'
import { loadCredentialsFromEnv, loadSavedCredentials, mergeCredentials, parseOptionalBoolean, parseOutputRetentionSeconds } from './credentials'
import { getPlatformDirFromCapacitorConfig } from './platform-paths'

let cwdQueue: Promise<unknown> = Promise.resolve()

/**
 * Run an async function with the process working directory temporarily set to `dir`.
 *
 * NOTE: `process.chdir()` is global, so this uses a simple in-process queue to avoid
 * concurrent calls interfering with each other.
 */
async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const previous = cwd()
    try {
      chdir(dir)
    }
    catch (error) {
      throw new Error(`Failed to change working directory to "${dir}": ${(error as Error).message}`)
    }

    try {
      return await fn()
    }
    finally {
      try {
        chdir(previous)
      }
      catch {
        // Best-effort restore; ignore to avoid masking original errors.
      }
    }
  }

  const p = cwdQueue.then(run, run)
  cwdQueue = p.then(() => undefined, () => undefined)
  return p
}

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

const IOS_DOC_URL = 'https://capgo.app/docs/cli/cloud-build/ios/'

const IOS_REQUIRED_CREDENTIALS: Array<{ key: keyof BuildCredentials, hint: string }> = [
  { key: 'BUILD_CERTIFICATE_BASE64', hint: '--build-certificate-base64' },
  { key: 'BUILD_PROVISION_PROFILE_BASE64', hint: '--build-provision-profile-base64' },
  { key: 'APPLE_KEY_ID', hint: '--apple-key-id' },
  { key: 'APPLE_ISSUER_ID', hint: '--apple-issuer-id' },
  { key: 'APPLE_KEY_CONTENT', hint: '--apple-key-content' },
  { key: 'APP_STORE_CONNECT_TEAM_ID', hint: '--apple-team-id' },
  { key: 'APPLE_PROFILE_NAME', hint: '--apple-profile-name' },
]

type CredentialSource = 'cli' | 'env' | 'saved' | 'missing'

interface ProvisioningProfileSummary {
  name?: string
  uuid?: string
  teamId?: string
  appIdentifier?: string
  bundleId?: string
  expirationDate?: string
}

interface CertificateSummary {
  fingerprint: string
  subject?: string
  issuer?: string
  expirationDate?: string
  parseError?: string
  opensslUnavailable?: boolean
  invalidPassword?: boolean
}

function hasCredentialValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function credentialSourceLabel(source: CredentialSource): string {
  if (source === 'cli')
    return 'CLI argument'
  if (source === 'env')
    return 'environment variable'
  if (source === 'saved')
    return 'saved credentials'
  return 'missing'
}

function resolveCredentialSource(
  key: keyof BuildCredentials,
  cliCredentials: Partial<BuildCredentials>,
  envCredentials: Partial<BuildCredentials>,
  savedCredentials: Partial<BuildCredentials> | undefined,
): CredentialSource {
  if (hasCredentialValue(cliCredentials[key]))
    return 'cli'
  if (hasCredentialValue(envCredentials[key]))
    return 'env'
  if (savedCredentials && hasCredentialValue(savedCredentials[key]))
    return 'saved'
  return 'missing'
}

function toStrictBase64Buffer(rawValue: string | undefined, credentialName: string): Buffer {
  if (!hasCredentialValue(rawValue)) {
    throw new Error(`${credentialName} is empty`)
  }

  const normalized = rawValue.replaceAll(/\s+/g, '')
  if (!normalized) {
    throw new Error(`${credentialName} is not valid base64`)
  }

  // Some secret managers strip trailing '=' padding; normalize before validation.
  const paddingRemainder = normalized.length % 4
  const paddedNormalized = paddingRemainder === 0
    ? normalized
    : normalized + '='.repeat(4 - paddingRemainder)

  if (!/^[a-z0-9+/]+={0,2}$/i.test(paddedNormalized)) {
    throw new Error(`${credentialName} is not valid base64`)
  }

  const decoded = Buffer.from(paddedNormalized, 'base64')
  if (!decoded.length) {
    throw new Error(`${credentialName} decoded to an empty payload`)
  }

  const stripBase64Padding = (value: string): string => {
    let end = value.length
    while (end > 0 && value[end - 1] === '=') {
      end--
    }
    return value.slice(0, end)
  }

  const reEncoded = stripBase64Padding(decoded.toString('base64'))
  const comparableInput = stripBase64Padding(paddedNormalized)
  if (reEncoded !== comparableInput) {
    throw new Error(`${credentialName} is not valid base64`)
  }

  return decoded
}

function extractTagValue(valueSource: string, tag: 'string' | 'date'): string | undefined {
  const openTag = `<${tag}>`
  if (!valueSource.startsWith(openTag)) {
    return undefined
  }

  const closeTag = `</${tag}>`
  const valueEnd = valueSource.indexOf(closeTag, openTag.length)
  if (valueEnd < 0) {
    return undefined
  }

  const value = valueSource.slice(openTag.length, valueEnd).trim()
  return value || undefined
}

function extractPlistString(xml: string, key: string): string | undefined {
  const keyOpenTag = '<key>'
  const keyCloseTag = '</key>'
  let searchFrom = 0

  while (searchFrom < xml.length) {
    const keyStart = xml.indexOf(keyOpenTag, searchFrom)
    if (keyStart < 0) {
      break
    }

    const keyEnd = xml.indexOf(keyCloseTag, keyStart + keyOpenTag.length)
    if (keyEnd < 0) {
      break
    }

    const candidateKey = xml.slice(keyStart + keyOpenTag.length, keyEnd).trim()
    searchFrom = keyEnd + keyCloseTag.length

    if (candidateKey !== key) {
      continue
    }

    const valueSource = xml.slice(searchFrom).trimStart()
    return extractTagValue(valueSource, 'string') || extractTagValue(valueSource, 'date')
  }

  return undefined
}

function summarizeProvisioningProfile(base64Profile: string, credentialName: string): ProvisioningProfileSummary {
  const profileBuffer = toStrictBase64Buffer(base64Profile, credentialName)
  const profileContent = profileBuffer.toString('utf8')

  const xmlStart = profileContent.indexOf('<?xml')
  const plistEndIndex = profileContent.indexOf('</plist>')
  if (xmlStart < 0 || plistEndIndex < 0) {
    throw new Error(`${credentialName} does not look like a valid provisioning profile`)
  }

  const plistXml = profileContent.slice(xmlStart, plistEndIndex + '</plist>'.length)

  const teamId = /<key>\s*TeamIdentifier\s*<\/key>\s*<array>\s*<string>([^<]+)<\/string>/i.exec(plistXml)?.[1]?.trim()
  const appIdentifier = /<key>\s*Entitlements\s*<\/key>\s*<dict>[\s\S]*?<key>\s*application-identifier\s*<\/key>\s*<string>([^<]+)<\/string>/i.exec(plistXml)?.[1]?.trim()

  let bundleId: string | undefined
  if (appIdentifier?.includes('.')) {
    bundleId = appIdentifier.slice(appIdentifier.indexOf('.') + 1)
  }

  return {
    name: extractPlistString(plistXml, 'Name'),
    uuid: extractPlistString(plistXml, 'UUID'),
    teamId,
    appIdentifier,
    bundleId,
    expirationDate: extractPlistString(plistXml, 'ExpirationDate'),
  }
}

function extractOpenSslError(error: unknown): string {
  if (!(error instanceof Error))
    return String(error)

  const execError = error as Error & { stderr?: Buffer | string, code?: string }
  if (execError.code === 'ENOENT') {
    return 'OpenSSL is not available in this environment'
  }

  let stderr = ''
  if (execError.stderr) {
    stderr = typeof execError.stderr === 'string'
      ? execError.stderr
      : execError.stderr.toString('utf8')
  }
  return `${error.message} ${stderr}`.replaceAll(/\s+/g, ' ').trim()
}

async function summarizeCertificate(base64Certificate: string, p12Password: string | undefined): Promise<CertificateSummary> {
  const certificateBuffer = toStrictBase64Buffer(base64Certificate, 'BUILD_CERTIFICATE_BASE64')
  const fingerprint = createHash('sha256').update(certificateBuffer).digest('hex').slice(0, 16)
  const summary: CertificateSummary = { fingerprint }

  const tempDir = await mkdtemp(join(tmpdir(), 'capgo-cert-'))
  const certPath = join(tempDir, 'build_certificate.p12')
  const opensslBinaryCandidates = [
    '/usr/bin/openssl',
    '/opt/homebrew/opt/openssl@3/bin/openssl',
    '/opt/homebrew/bin/openssl',
    '/usr/local/bin/openssl',
  ]

  try {
    await writeFile(certPath, certificateBuffer)
    const opensslBinary = opensslBinaryCandidates.find(path => existsSync(path))
    if (!opensslBinary) {
      throw new Error('OpenSSL is not available in this environment')
    }

    const pem = execFileSync(
      opensslBinary,
      // `-passin` is a valid OpenSSL option used by `openssl pkcs12`.
      ['pkcs12', '-in', certPath, '-clcerts', '-nokeys', '-passin', 'env:CAPGO_P12_PASS'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CAPGO_P12_PASS: p12Password || '',
        },
      },
    )

    const x509Info = execFileSync(
      opensslBinary,
      ['x509', '-noout', '-subject', '-issuer', '-enddate'],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        input: pem,
      },
    )

    for (const rawLine of x509Info.split('\n')) {
      const line = rawLine.trim()
      if (!line)
        continue
      if (line.startsWith('subject=')) {
        summary.subject = line.slice('subject='.length).trim()
      }
      else if (line.startsWith('issuer=')) {
        summary.issuer = line.slice('issuer='.length).trim()
      }
      else if (line.startsWith('notAfter=')) {
        summary.expirationDate = line.slice('notAfter='.length).trim()
      }
    }
  }
  catch (error) {
    const parsedError = extractOpenSslError(error)
    summary.parseError = parsedError
    const normalized = parsedError.toLowerCase()
    summary.opensslUnavailable = normalized.includes('openssl is not available')
    summary.invalidPassword = normalized.includes('invalid password')
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }

  return summary
}

function isExpired(dateValue: string | undefined): boolean {
  if (!hasCredentialValue(dateValue))
    return false
  const parsed = new Date(dateValue)
  if (Number.isNaN(parsed.getTime()))
    return false
  return parsed.getTime() <= Date.now()
}

export type { BuildCredentials, BuildRequestOptions, BuildRequestResponse, BuildRequestResult } from '../schemas/build'

/**
 * Stream build logs from the server via WebSocket.
 * Returns the final status if detected from the stream, or null if stream ended without status.
 */
type StatusCheckFn = () => Promise<string | null>

const TERMINAL_STATUSES = ['succeeded', 'failed', 'expired', 'released', 'cancelled'] as const
const TERMINAL_STATUS_SET = new Set<string>(TERMINAL_STATUSES)

async function streamBuildLogs(
  silent: boolean,
  _verbose = false,
  logsUrl?: string,
  logsToken?: string,
  statusCheck?: StatusCheckFn,
  abortSignal?: AbortSignal,
  onStreamingGiveUp?: () => void,
): Promise<string | null> {
  if (silent)
    return null

  let finalStatus: string | null = null
  let hasReceivedLogs = false
  const processLogMessage = (message: string) => {
    if (!message.trim())
      return

    // Check for final status messages from the server
    // Server sends "Build succeeded", "Build failed", "Job already succeeded", etc.
    const statusMatch = message.match(/^(?:Build|Job already) (succeeded|failed|expired|released|cancelled)$/i)
    if (statusMatch) {
      finalStatus = statusMatch[1].toLowerCase()
      // Don't display status messages as log lines - they'll be displayed as final status
      return
    }

    // Don't display logs after we've received a final status (e.g., cleanup messages after failure)
    if (finalStatus)
      return

    // Print log line directly to console (no spinner to avoid _events errors)
    if (!hasReceivedLogs) {
      hasReceivedLogs = true
      // eslint-disable-next-line no-console
      console.log('') // Add blank line before first log
    }
    // eslint-disable-next-line no-console
    console.log(message)
  }

  const streamViaLogsWorker = async (): Promise<string | null> => {
    if (!logsUrl || !logsToken)
      return null

    const baseUrl = logsUrl.replace(/\/+$/, '')
    const startUrl = `${baseUrl}/start`
    const streamUrl = `${baseUrl}/stream?token=${encodeURIComponent(logsToken)}`
    const websocketUrl = streamUrl
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:')

    if (!silent) {
      // eslint-disable-next-line no-console
      console.log('Connecting to log streaming...')
    }

    const startResponse = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'x-capgo-log-token': logsToken,
      },
    })
    if (!startResponse.ok) {
      const errorText = await startResponse.text().catch(() => 'unknown error')
      if (!silent)
        console.warn(`Could not start log session (${startResponse.status}): ${errorText}`)
      return null
    }

    return await new Promise((resolve) => {
      let settled = false
      const maxRetries = 10
      let retryCount = 0
      let gaveUp = false
      const ws = new PartySocket(websocketUrl, undefined, {
        maxRetries,
        WebSocket: WS,
      })
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null
      let lastConfirmedId = 0
      let lastMessageAt = Date.now()
      let statusCheckInFlight = false
      const HEARTBEAT_INTERVAL_MS = 2000
      const HEARTBEAT_MISSES_BEFORE_STATUS = 4
      const terminalStatuses = TERMINAL_STATUS_SET
      let abortListener: (() => void) | null = null
      let timeout: ReturnType<typeof setTimeout> | null = null

      const finish = (status: string | null) => {
        if (settled)
          return
        settled = true
        if (timeout) {
          clearTimeout(timeout)
          timeout = null
        }
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        if (abortSignal && abortListener) {
          abortSignal.removeEventListener('abort', abortListener)
          abortListener = null
        }
        try {
          ws.close()
        }
        catch {
          // ignore
        }
        resolve(status)
      }

      timeout = setTimeout(() => {
        if (!settled) {
          if (!silent)
            console.warn('Log streaming timed out after 3 hours')
          finish(null)
        }
      }, 3 * 60 * 60 * 1000)

      const startHeartbeat = () => {
        if (heartbeatTimer)
          return
        heartbeatTimer = setInterval(async () => {
          try {
            if (ws.readyState === PartySocket.OPEN) {
              ws.send(JSON.stringify({ type: 'heartbeat', lastId: lastConfirmedId }))
            }
            const now = Date.now()
            if (
              statusCheck
              && !statusCheckInFlight
              && (now - lastMessageAt) >= HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISSES_BEFORE_STATUS
            ) {
              statusCheckInFlight = true
              try {
                const status = await statusCheck()
                if (status && terminalStatuses.has(status)) {
                  finalStatus = status
                  finish(finalStatus)
                }
              }
              finally {
                statusCheckInFlight = false
              }
            }
          }
          catch (error) {
            if (!silent)
              log.warn(`Heartbeat encountered an error, continuing... ${String(error)}`)
          }
        }, HEARTBEAT_INTERVAL_MS)
      }

      startHeartbeat()

      if (abortSignal) {
        abortListener = () => {
          if (!settled)
            finish('cancelled')
        }
        if (abortSignal.aborted) {
          finish('cancelled')
          return
        }
        abortSignal.addEventListener('abort', abortListener)
      }

      ws.addEventListener('message', (event: MessageEvent) => {
        let raw = ''
        if (typeof event.data === 'string') {
          raw = event.data
        }
        else if (event.data instanceof ArrayBuffer) {
          raw = new TextDecoder().decode(event.data)
        }
        else if (ArrayBuffer.isView(event.data)) {
          const view = event.data as ArrayBufferView
          raw = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
        }
        else if (event.data && typeof (event.data as { toString?: () => string }).toString === 'function') {
          raw = (event.data as { toString: () => string }).toString()
        }

        let parsed: {
          id?: number
          message?: string
          type?: string
          status?: string
          messages?: Array<{ id?: number, message?: string, type?: string, status?: string }>
        } | null = null
        try {
          parsed = JSON.parse(raw)
        }
        catch {
          parsed = null
        }

        const handleEntry = (entry: { id?: number, message?: string, type?: string, status?: string }) => {
          if (entry.type === 'status' && typeof entry.status === 'string') {
            const status = entry.status.toLowerCase()
            lastMessageAt = Date.now()
            if (terminalStatuses.has(status)) {
              finalStatus = status
            }
            return
          }
          if (entry.type === 'log' && typeof entry.message === 'string') {
            lastMessageAt = Date.now()
            processLogMessage(entry.message)
            return
          }
          if (typeof entry.message === 'string') {
            lastMessageAt = Date.now()
            processLogMessage(entry.message)
          }
        }

        if (parsed?.type === 'heartbeat_response') {
          return
        }

        if (parsed?.type === 'batch_messages' && Array.isArray(parsed.messages)) {
          let maxId = lastConfirmedId
          for (const entry of parsed.messages) {
            handleEntry(entry)
            if (typeof entry.id === 'number')
              maxId = Math.max(maxId, entry.id)
          }
          if (maxId > lastConfirmedId) {
            lastConfirmedId = maxId
            if (ws.readyState === PartySocket.OPEN) {
              try {
                ws.send(JSON.stringify({ type: 'confirmed_received', lastId: maxId }))
              }
              catch (error) {
                if (!silent)
                  log.warn(`Failed to send log confirmation, continuing... ${String(error)}`)
              }
            }
          }
        }
        else {
          if (parsed) {
            handleEntry(parsed)
          }
          else if (raw) {
            lastMessageAt = Date.now()
            processLogMessage(raw)
          }

          if (parsed && typeof parsed.id === 'number') {
            lastConfirmedId = parsed.id
            if (ws.readyState === PartySocket.OPEN) {
              try {
                ws.send(JSON.stringify({ type: 'confirmed_received', lastId: parsed.id }))
              }
              catch (error) {
                if (!silent)
                  log.warn(`Failed to send log confirmation, continuing... ${String(error)}`)
              }
            }
          }
        }

        if (finalStatus) {
          finish(finalStatus)
        }
      })

      ws.addEventListener('error', () => {
        retryCount += 1
        if (!silent)
          console.warn(`Log stream encountered an error, retrying (${retryCount}/${maxRetries})...`)
        if (!gaveUp && retryCount >= maxRetries) {
          gaveUp = true
          if (!silent)
            log.warn('Log stream retry limit reached. Falling back to status checks.')
          if (onStreamingGiveUp)
            onStreamingGiveUp()
          finish(null)
        }
      })

      ws.addEventListener('close', () => {
        if (settled)
          return
        if (finalStatus) {
          finish(finalStatus)
          return
        }
        if (!silent)
          log.warn('Log stream closed, waiting for reconnect...')
      })
    })
  }

  try {
    const directStatus = await streamViaLogsWorker()
    if (directStatus || finalStatus)
      return directStatus || finalStatus
  }
  catch (err) {
    if (!silent)
      log.warn(`Direct log streaming failed${err instanceof Error ? `: ${err.message}` : ''}`)
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
  showStatusChecks = false,
  abortSignal?: AbortSignal,
): Promise<string> {
  const maxAttempts = 120 // 10 minutes max (5 second intervals)
  let attempts = 0

  while (attempts < maxAttempts) {
    if (abortSignal?.aborted)
      return 'cancelled'
    try {
      const response = await fetch(`${host}/build/status?job_id=${encodeURIComponent(jobId)}&app_id=${encodeURIComponent(appId)}&platform=${platform}`, {
        headers: {
          authorization: apikey,
        },
        signal: abortSignal,
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

      const normalized = status.status?.toLowerCase?.() ?? ''

      if (!silent && showStatusChecks)
        log.info(`Build status: ${normalized || status.status}`)

      if (TERMINAL_STATUS_SET.has(normalized)) {
        return normalized
      }

      // Still running, wait and retry
      await new Promise(resolve => setTimeout(resolve, 5000))
      attempts++
    }
    catch (error) {
      if (abortSignal?.aborted)
        return 'cancelled'
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
 * Extract native node_modules roots that contain platform folders.
 */
interface NativeDependencies {
  packages: Set<string> // Package paths like @capacitor/app
  usesSPM: boolean // true = SPM (Package.swift), false = CocoaPods (podspec)
}

async function extractNativeDependencies(
  projectDir: string,
  platform: 'ios' | 'android',
  platformDir: string,
): Promise<NativeDependencies> {
  const packages = new Set<string>()
  let usesSPM = false

  if (platform === 'ios') {
    // Check for Swift Package Manager first (Capacitor 7+)
    // SPM takes precedence over CocoaPods
    const spmPackagePath = join(projectDir, platformDir, 'App', 'CapApp-SPM', 'Package.swift')
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
      const podfilePath = join(projectDir, platformDir, 'App', 'Podfile')
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
    const settingsGradlePath = join(projectDir, platformDir, 'capacitor.settings.gradle')
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
function shouldIncludeFile(filePath: string, platform: 'ios' | 'android', nativeDeps: NativeDependencies, platformDir: string): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/')

  // Always include platform folder
  if (normalizedPath.startsWith(`${platformDir}/`))
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
function addDirectoryToZip(
  zip: AdmZip,
  dirPath: string,
  zipPath: string,
  platform: 'ios' | 'android',
  nativeDeps: NativeDependencies,
  platformDir: string,
) {
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

      // Always recurse into node_modules (we filter inside)
      if (item === 'node_modules') {
        addDirectoryToZip(zip, itemPath, itemZipPath, platform, nativeDeps, platformDir)
        continue
      }

      // For resources folder, always recurse
      if (item === 'resources') {
        addDirectoryToZip(zip, itemPath, itemZipPath, platform, nativeDeps, platformDir)
        continue
      }

      // For other directories, check if we need to recurse into them
      // We should recurse if:
      // 1. This directory itself should be included (matches a pattern)
      // 2. This directory is a prefix of a dependency path (need to traverse to reach it)
      const normalizedItemPath = itemZipPath.replace(/\\/g, '/')
      const shouldRecurse = shouldIncludeFile(itemZipPath, platform, nativeDeps, platformDir)
        // Ensure we can reach nested platform directories like projects/app/android.
        || platformDir === normalizedItemPath
        || platformDir.startsWith(`${normalizedItemPath}/`)
        || Array.from(nativeDeps.packages).some((pkg) => {
          const depPath = `node_modules/${pkg}/`
          return depPath.startsWith(`${normalizedItemPath}/`) || normalizedItemPath.startsWith(`node_modules/${pkg}`)
        })

      if (shouldRecurse) {
        addDirectoryToZip(zip, itemPath, itemZipPath, platform, nativeDeps, platformDir)
      }
    }
    else if (stats.isFile()) {
      // Skip excluded files
      if (item === '.DS_Store' || item.endsWith('.log'))
        continue

      // Check if we should include this file
      if (shouldIncludeFile(itemZipPath, platform, nativeDeps, platformDir)) {
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
async function zipDirectory(projectDir: string, outputPath: string, platform: 'ios' | 'android', capConfig: any): Promise<void> {
  const platformDir = getPlatformDirFromCapacitorConfig(capConfig, platform)

  // Extract which node_modules have native code for this platform
  const nativeDeps = await extractNativeDependencies(projectDir, platform, platformDir)

  const zip = new AdmZip()

  // Add files with filtering
  addDirectoryToZip(zip, projectDir, '', platform, nativeDeps, platformDir)

  // Cloud builders may only parse JSON configs. Ensure a resolved JSON exists even if the project
  // uses capacitor.config.ts/js, so android.path/ios.path is visible remotely.
  const configJsonPath = join(projectDir, 'capacitor.config.json')
  if (capConfig && !existsSync(configJsonPath)) {
    const json = `${JSON.stringify(capConfig, null, 2)}\n`
    zip.addFile('capacitor.config.json', Buffer.from(json, 'utf-8'))
  }

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
 * - Build outputs may optionally be uploaded for time-limited download links
 */
export async function requestBuildInternal(appId: string, options: BuildRequestOptions, silent = false): Promise<BuildRequestResult> {
  // Track build time
  const buildStartTime = Date.now()
  const verbose = options.verbose ?? false

  try {
    options.apikey = options.apikey || findSavedKey(silent)
    const projectDir = resolve(options.path || cwd())

    // @capacitor/cli loadConfig() is cwd-based; honor --path for monorepos/workspaces.
    const config = await withCwd(projectDir, () => getConfig())
    appId = appId || config?.config?.appId

    if (!appId) {
      throw new Error('Missing argument, you need to provide a appId, or be in a capacitor project')
    }

    if (!options.platform) {
      throw new Error('Missing required argument: --platform <ios|android>')
    }

    if (options.platform !== 'ios' && options.platform !== 'android') {
      throw new Error(`Invalid platform "${options.platform}". Must be "ios" or "android"`)
    }

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
      log.info(`   Build outputs can optionally be uploaded for time-limited download links\n`)
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
    if (options.outputUpload !== undefined) {
      cliCredentials.BUILD_OUTPUT_UPLOAD_ENABLED = parseOptionalBoolean(options.outputUpload) ? 'true' : 'false'
    }
    if (options.outputRetention) {
      cliCredentials.BUILD_OUTPUT_RETENTION_SECONDS = String(parseOutputRetentionSeconds(options.outputRetention))
    }

    // Merge credentials from all three sources:
    // 1. CLI args (highest priority)
    // 2. Environment variables (middle priority)
    // 3. Saved credentials file (lowest priority)
    const envCredentials = loadCredentialsFromEnv()
    const savedCredentials = await loadSavedCredentials(appId)
    const savedPlatformCredentials = savedCredentials?.[options.platform]

    const mergedCredentials = await mergeCredentials(
      appId,
      options.platform,
      Object.keys(cliCredentials).length > 0 ? cliCredentials : undefined,
      { envCredentials, savedCredentials },
    )
    const sourceOf = (key: keyof BuildCredentials): CredentialSource =>
      resolveCredentialSource(key, cliCredentials, envCredentials, savedPlatformCredentials)

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
        log.error(`     bunx @capgo/cli build credentials save --appId ${appId} --platform ${options.platform}`)
        log.error('')
        log.error('Documentation:')
        log.error('  https://capgo.app/docs/cli/cloud-build/credentials/')
      }
      throw new Error('No credentials found. Please provide credentials before building.')
    }

    // Validate platform-specific required credentials
    const missingCreds: string[] = []

    if (options.platform === 'ios') {
      for (const requirement of IOS_REQUIRED_CREDENTIALS) {
        if (!hasCredentialValue(mergedCredentials[requirement.key])) {
          missingCreds.push(`${requirement.key} (or ${requirement.hint})`)
        }
      }
      if (!hasCredentialValue(mergedCredentials.P12_PASSWORD) && !silent) {
        log.warn('⚠️  P12_PASSWORD not provided - assuming certificate has no password')
        log.warn('   If your certificate requires a password, provide it with --p12-password')
      }
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
        if (options.platform === 'ios') {
          log.error('')
          log.error('Detected iOS credential sources:')
          for (const requirement of IOS_REQUIRED_CREDENTIALS) {
            const source = sourceOf(requirement.key)
            const valueStatus = source === 'missing' ? 'missing' : `set via ${credentialSourceLabel(source)}`
            log.error(`  • ${requirement.key}: ${valueStatus}`)
          }
          log.error('')
          log.error('Note: iOS cloud build currently uploads to TestFlight.')
          log.error('      App Store Connect credentials are required even if you want the IPA artifact output.')
        }
        log.error('')
        log.error('Provide credentials via:')
        log.error(`  1. CLI arguments: bunx @capgo/cli build request --platform ${options.platform} ...`)
        log.error('  2. Environment variables: export APPLE_KEY_ID="..." APPLE_PROFILE_NAME="..."')
        log.error(`  3. Saved credentials: bunx @capgo/cli build credentials save --platform ${options.platform} ...`)
        log.error('')
        log.error('Documentation:')
        const documentationUrl = options.platform === 'ios'
          ? IOS_DOC_URL
          : `https://capgo.app/docs/cli/cloud-build/${options.platform}/`
        log.error(`  ${documentationUrl}`)
      }
      throw new Error(`Missing required credentials for ${options.platform}: ${missingCreds.join(', ')}`)
    }

    if (options.platform === 'ios') {
      const certificateBase64 = mergedCredentials.BUILD_CERTIFICATE_BASE64
      const provisioningProfileBase64 = mergedCredentials.BUILD_PROVISION_PROFILE_BASE64
      const profileName = mergedCredentials.APPLE_PROFILE_NAME
      const teamId = mergedCredentials.APP_STORE_CONNECT_TEAM_ID
      const keyId = mergedCredentials.APPLE_KEY_ID
      const issuerId = mergedCredentials.APPLE_ISSUER_ID
      const appleKeyContent = mergedCredentials.APPLE_KEY_CONTENT

      if (!hasCredentialValue(certificateBase64) || !hasCredentialValue(provisioningProfileBase64) || !hasCredentialValue(profileName)
        || !hasCredentialValue(teamId) || !hasCredentialValue(keyId) || !hasCredentialValue(issuerId) || !hasCredentialValue(appleKeyContent)) {
        throw new Error('Internal validation error: iOS credentials are incomplete after preflight checks.')
      }

      const certSummary = await summarizeCertificate(certificateBase64, mergedCredentials.P12_PASSWORD)
      if (certSummary.invalidPassword) {
        throw new Error('Invalid P12 certificate password. BUILD_CERTIFICATE_BASE64 cannot be decrypted with the provided P12_PASSWORD.')
      }

      const profileSummary = summarizeProvisioningProfile(provisioningProfileBase64, 'BUILD_PROVISION_PROFILE_BASE64')
      if (isExpired(profileSummary.expirationDate)) {
        throw new Error(`Provisioning profile is expired (${profileSummary.expirationDate}). Regenerate the profile and save credentials again.`)
      }
      if (isExpired(certSummary.expirationDate)) {
        throw new Error(`Signing certificate is expired (${certSummary.expirationDate}). Generate a new certificate and update BUILD_CERTIFICATE_BASE64.`)
      }

      let profileSummaryProd: ProvisioningProfileSummary | undefined
      if (hasCredentialValue(mergedCredentials.BUILD_PROVISION_PROFILE_BASE64_PROD)) {
        profileSummaryProd = summarizeProvisioningProfile(mergedCredentials.BUILD_PROVISION_PROFILE_BASE64_PROD, 'BUILD_PROVISION_PROFILE_BASE64_PROD')
        if (isExpired(profileSummaryProd.expirationDate)) {
          throw new Error(`Production provisioning profile is expired (${profileSummaryProd.expirationDate}). Regenerate BUILD_PROVISION_PROFILE_BASE64_PROD.`)
        }
      }

      // Validate APPLE_KEY_CONTENT base64; result is intentionally discarded and used only for validation side effects.
      toStrictBase64Buffer(appleKeyContent, 'APPLE_KEY_CONTENT')

      if (!silent) {
        log.info('✓ iOS credential preflight passed')
        log.info(`  Profile name: ${profileName} (${credentialSourceLabel(sourceOf('APPLE_PROFILE_NAME'))})`)
        log.info(`  Team ID: ${teamId} (${credentialSourceLabel(sourceOf('APP_STORE_CONNECT_TEAM_ID'))})`)
        log.info(`  Apple Key ID: ${keyId} (${credentialSourceLabel(sourceOf('APPLE_KEY_ID'))})`)
        log.info(`  Apple Issuer ID: ${issuerId} (${credentialSourceLabel(sourceOf('APPLE_ISSUER_ID'))})`)
        log.info(`  PKCS#12 checksum: ${certSummary.fingerprint} (${credentialSourceLabel(sourceOf('BUILD_CERTIFICATE_BASE64'))})`)
        if (certSummary.subject) {
          log.info(`  Certificate subject: ${certSummary.subject}`)
        }
        if (certSummary.expirationDate) {
          log.info(`  Certificate expires: ${certSummary.expirationDate}`)
        }
        if (certSummary.parseError && !certSummary.opensslUnavailable) {
          log.warn(`⚠️  Could not fully inspect the P12 certificate locally: ${certSummary.parseError}`)
        }
        if (certSummary.opensslUnavailable) {
          log.warn('⚠️  OpenSSL not available locally; certificate metadata inspection skipped.')
        }
        log.info(`  Provisioning profile: ${profileSummary.name || '(name not found)'} (${credentialSourceLabel(sourceOf('BUILD_PROVISION_PROFILE_BASE64'))})`)
        if (profileSummary.uuid) {
          log.info(`  Provisioning profile UUID: ${profileSummary.uuid}`)
        }
        if (profileSummary.bundleId) {
          log.info(`  Provisioning profile bundle ID: ${profileSummary.bundleId}`)
        }
        if (profileSummary.teamId) {
          log.info(`  Provisioning profile team ID: ${profileSummary.teamId}`)
        }
        if (profileSummary.expirationDate) {
          log.info(`  Provisioning profile expires: ${profileSummary.expirationDate}`)
        }
        if (profileSummaryProd) {
          log.info(`  Production profile: ${profileSummaryProd.name || '(name not found)'} (${credentialSourceLabel(sourceOf('BUILD_PROVISION_PROFILE_BASE64_PROD'))})`)
          if (profileSummaryProd.expirationDate) {
            log.info(`  Production profile expires: ${profileSummaryProd.expirationDate}`)
          }
        }
      }

      if (profileSummary.name && profileSummary.name !== profileName && !silent) {
        log.warn(`⚠️  APPLE_PROFILE_NAME (${profileName}) differs from profile Name (${profileSummary.name}).`)
      }
      if (profileSummary.teamId && profileSummary.teamId !== teamId && !silent) {
        log.warn(`⚠️  APP_STORE_CONNECT_TEAM_ID (${teamId}) differs from provisioning profile team (${profileSummary.teamId}).`)
      }
    }

    // Add credentials to request payload
    requestPayload.credentials = {
      ...mergedCredentials,
      CAPGO_CLI_VERSION: pack.version,
    }
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

      await zipDirectory(projectDir, zipPath, options.platform, config?.config)

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

      const startResult = await startResponse.json() as { status?: string, logs_url?: string, logs_token?: string }

      if (!silent) {
        log.success('Build started!')
        log.info('Streaming build logs...')
      }

      const abortController = new AbortController()
      let cancelRequested = false
      const cancelBuild = async () => {
        if (cancelRequested)
          return
        cancelRequested = true
        const cancelAbort = new AbortController()
        const timeout = setTimeout(() => cancelAbort.abort(), 4000)
        try {
          await fetch(`${host}/build/cancel/${buildRequest.job_id}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'authorization': options.apikey,
            },
            body: JSON.stringify({ app_id: appId }),
            signal: cancelAbort.signal,
          })
        }
        catch {
          // ignore cancellation errors
        }
        finally {
          clearTimeout(timeout)
        }
      }

      const onSigint = async () => {
        try {
          if (cancelRequested) {
            process.exit(1)
          }
          if (!silent)
            log.warn('Canceling build... (press Ctrl+C again to force quit)')
          await cancelBuild()
          abortController.abort()
        }
        catch {
          // Prevent unhandled rejection from crashing the process
        }
      }

      process.on('SIGINT', onSigint)

      let finalStatus: string
      // Stream logs from the build - returns final status if detected from stream
      let showStatusChecks = false
      const statusCheck = async (): Promise<string | null> => {
        try {
          const response = await fetch(`${host}/build/status?job_id=${encodeURIComponent(buildRequest.job_id)}&app_id=${encodeURIComponent(appId)}&platform=${options.platform}`, {
            headers: {
              authorization: options.apikey,
            },
          })
          if (!response.ok) {
            return null
          }
          const status = await response.json() as { status: string }
          const normalized = status.status?.toLowerCase?.() ?? ''
          if (!silent && showStatusChecks)
            log.info(`Build status: ${normalized || status.status}`)
          if (TERMINAL_STATUS_SET.has(normalized)) {
            return normalized
          }
          return null
        }
        catch {
          return null
        }
      }

      let streamStatus: string | null = null
      try {
        streamStatus = await streamBuildLogs(
          silent,
          verbose,
          startResult.logs_url,
          startResult.logs_token,
          statusCheck,
          abortController.signal,
          () => {
            showStatusChecks = true
          },
        )
      }
      finally {
        process.removeListener('SIGINT', onSigint)
      }

      // Only poll if we didn't get the final status from the stream
      if (streamStatus) {
        finalStatus = streamStatus
        // Persist terminal status to the database via /build/status.
        // The WebSocket only delivers status to the CLI — calling the API
        // endpoint triggers the backend to write status + last_error into build_requests.
        if (TERMINAL_STATUS_SET.has(streamStatus))
          await statusCheck().catch(() => {})
      }
      else {
        // Fall back to polling if stream ended without final status
        finalStatus = await pollBuildStatus(host, buildRequest.job_id, appId, options.platform, options.apikey, silent, showStatusChecks, abortController.signal)
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
