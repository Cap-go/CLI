/**
 * Build Credentials Management
 *
 * This module provides utilities for managing build credentials locally on your machine.
 *
 * IMPORTANT SECURITY NOTICE:
 * - Credentials are stored LOCALLY in ~/.capgo-credentials/credentials.json on YOUR machine only
 * - When you request a build, credentials are sent to Capgo's build servers
 * - Credentials are NEVER stored permanently on Capgo servers
 * - Credentials are used only during the build process and are automatically deleted
 *   from Capgo servers after the build completes (maximum 24 hours)
 * - Builds are sent DIRECTLY to app stores (Apple App Store / Google Play Store)
 * - Capgo does NOT keep any build artifacts - everything goes directly to the stores
 *
 * Security best practices:
 * - Ensure ~/.capgo-credentials/ directory has restricted file permissions
 * - Never commit credentials.json to version control
 * - Use separate credentials for CI/CD vs local development
 * - Rotate credentials regularly
 */

import type { BuildCredentials } from './request'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cwd, env } from 'node:process'

const CREDENTIALS_DIR = join(homedir(), '.capgo-credentials')
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'credentials.json')
const LOCAL_CREDENTIALS_FILE = '.capgo-credentials.json'

/**
 * Get the credentials file path based on local flag
 */
function getCredentialsPath(local?: boolean): string {
  return local ? join(cwd(), LOCAL_CREDENTIALS_FILE) : CREDENTIALS_FILE
}

/**
 * Get the credentials directory (only for global storage)
 */
function getCredentialsDir(local?: boolean): string | null {
  return local ? null : CREDENTIALS_DIR
}

export interface CredentialFile {
  // iOS file paths
  BUILD_CERTIFICATE_FILE?: string
  BUILD_PROVISION_PROFILE_FILE?: string
  BUILD_PROVISION_PROFILE_FILE_PROD?: string
  APPLE_KEY_FILE?: string

  // Android file paths
  ANDROID_KEYSTORE_PATH?: string
  PLAY_CONFIG_JSON_PATH?: string
}

/**
 * Per-app credentials structure
 * Each app can have its own iOS and Android credentials
 */
export interface SavedCredentials {
  ios?: Partial<BuildCredentials>
  android?: Partial<BuildCredentials>
}

/**
 * All credentials file structure
 * Maps appId -> credentials for that app
 */
export interface AllCredentials {
  [appId: string]: SavedCredentials
}

/**
 * Convert a file to base64 string
 */
async function fileToBase64(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  return buffer.toString('base64')
}

/**
 * Load all credentials from file (global or local)
 */
async function loadAllCredentials(local?: boolean): Promise<AllCredentials> {
  try {
    const filePath = getCredentialsPath(local)
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as AllCredentials
  }
  catch {
    return {}
  }
}

/**
 * Load saved credentials for a specific app
 * Checks local file first, then global file
 */
export async function loadSavedCredentials(appId?: string, local?: boolean): Promise<SavedCredentials | null> {
  // If local is explicitly set, only check that location
  if (local !== undefined) {
    const all = await loadAllCredentials(local)
    if (!appId) {
      const appIds = Object.keys(all)
      if (appIds.length === 0)
        return null
      return all[appIds[0]] || null
    }
    return all[appId] || null
  }

  // Otherwise, check local first, then global (local takes precedence)
  const localAll = await loadAllCredentials(true)
  const globalAll = await loadAllCredentials(false)

  // If no appId provided, try to get default (backward compatibility)
  if (!appId) {
    // Check local first
    const localAppIds = Object.keys(localAll)
    if (localAppIds.length > 0)
      return localAll[localAppIds[0]] || null

    // Then global
    const globalAppIds = Object.keys(globalAll)
    if (globalAppIds.length === 0)
      return null
    return globalAll[globalAppIds[0]] || null
  }

  // Return local if exists, otherwise global
  return localAll[appId] || globalAll[appId] || null
}

/**
 * Save all credentials to file (global or local)
 */
async function saveAllCredentials(credentials: AllCredentials, local?: boolean): Promise<void> {
  const filePath = getCredentialsPath(local)
  const dir = getCredentialsDir(local)

  // Create directory only for global storage
  if (dir) {
    await mkdir(dir, { recursive: true })
  }

  await writeFile(filePath, JSON.stringify(credentials, null, 2), 'utf-8')
}

/**
 * Load credentials from environment variables
 * Only returns credentials that are actually set in env
 */
export function loadCredentialsFromEnv(): Partial<BuildCredentials> {
  const credentials: Partial<BuildCredentials> = {}

  // iOS credentials
  if (env.BUILD_CERTIFICATE_BASE64)
    credentials.BUILD_CERTIFICATE_BASE64 = env.BUILD_CERTIFICATE_BASE64
  if (env.BUILD_PROVISION_PROFILE_BASE64)
    credentials.BUILD_PROVISION_PROFILE_BASE64 = env.BUILD_PROVISION_PROFILE_BASE64
  if (env.BUILD_PROVISION_PROFILE_BASE64_PROD)
    credentials.BUILD_PROVISION_PROFILE_BASE64_PROD = env.BUILD_PROVISION_PROFILE_BASE64_PROD
  if (env.P12_PASSWORD)
    credentials.P12_PASSWORD = env.P12_PASSWORD
  if (env.APPLE_KEY_ID)
    credentials.APPLE_KEY_ID = env.APPLE_KEY_ID
  if (env.APPLE_ISSUER_ID)
    credentials.APPLE_ISSUER_ID = env.APPLE_ISSUER_ID
  if (env.APPLE_KEY_CONTENT)
    credentials.APPLE_KEY_CONTENT = env.APPLE_KEY_CONTENT
  if (env.APPLE_PROFILE_NAME)
    credentials.APPLE_PROFILE_NAME = env.APPLE_PROFILE_NAME
  if (env.APP_STORE_CONNECT_TEAM_ID)
    credentials.APP_STORE_CONNECT_TEAM_ID = env.APP_STORE_CONNECT_TEAM_ID

  // Android credentials
  if (env.ANDROID_KEYSTORE_FILE)
    credentials.ANDROID_KEYSTORE_FILE = env.ANDROID_KEYSTORE_FILE
  if (env.KEYSTORE_KEY_ALIAS)
    credentials.KEYSTORE_KEY_ALIAS = env.KEYSTORE_KEY_ALIAS
  if (env.KEYSTORE_KEY_PASSWORD)
    credentials.KEYSTORE_KEY_PASSWORD = env.KEYSTORE_KEY_PASSWORD
  if (env.KEYSTORE_STORE_PASSWORD)
    credentials.KEYSTORE_STORE_PASSWORD = env.KEYSTORE_STORE_PASSWORD
  if (env.PLAY_CONFIG_JSON)
    credentials.PLAY_CONFIG_JSON = env.PLAY_CONFIG_JSON

  return credentials
}

/**
 * Merge credentials from all three sources with proper precedence:
 * 1. CLI arguments (highest priority)
 * 2. Environment variables (middle priority)
 * 3. Saved credentials file (lowest priority)
 */
export async function mergeCredentials(
  appId: string,
  platform: 'ios' | 'android',
  cliArgs?: Partial<BuildCredentials>,
): Promise<BuildCredentials | undefined> {
  // Load from all three sources
  const saved = await loadSavedCredentials(appId)
  const envCreds = loadCredentialsFromEnv()

  // Start with saved credentials (lowest priority)
  const merged: Partial<BuildCredentials> = { ...(saved?.[platform] || {}) }

  // Merge env vars (middle priority)
  Object.assign(merged, envCreds)

  // Merge CLI args (highest priority)
  if (cliArgs) {
    Object.assign(merged, cliArgs)
  }

  // For Android: if only one password is provided, use it for both
  if (platform === 'android') {
    const hasKeyPassword = !!merged.KEYSTORE_KEY_PASSWORD
    const hasStorePassword = !!merged.KEYSTORE_STORE_PASSWORD

    if (hasKeyPassword && !hasStorePassword) {
      merged.KEYSTORE_STORE_PASSWORD = merged.KEYSTORE_KEY_PASSWORD
    }
    else if (!hasKeyPassword && hasStorePassword) {
      merged.KEYSTORE_KEY_PASSWORD = merged.KEYSTORE_STORE_PASSWORD
    }
  }

  // Return undefined if no credentials found at all
  return Object.keys(merged).length > 0 ? (merged as BuildCredentials) : undefined
}

/**
 * Convert file paths to base64 credentials
 */
export async function convertFilesToCredentials(
  platform: 'ios' | 'android',
  files: CredentialFile,
  passwords: Partial<BuildCredentials> = {},
): Promise<BuildCredentials> {
  const credentials: BuildCredentials = { ...passwords }

  if (platform === 'ios') {
    // iOS certificates and profiles
    if (files.BUILD_CERTIFICATE_FILE) {
      credentials.BUILD_CERTIFICATE_BASE64 = await fileToBase64(files.BUILD_CERTIFICATE_FILE)
    }
    if (files.BUILD_PROVISION_PROFILE_FILE) {
      credentials.BUILD_PROVISION_PROFILE_BASE64 = await fileToBase64(files.BUILD_PROVISION_PROFILE_FILE)
    }
    if (files.BUILD_PROVISION_PROFILE_FILE_PROD) {
      credentials.BUILD_PROVISION_PROFILE_BASE64_PROD = await fileToBase64(files.BUILD_PROVISION_PROFILE_FILE_PROD)
    }
    if (files.APPLE_KEY_FILE) {
      credentials.APPLE_KEY_CONTENT = await fileToBase64(files.APPLE_KEY_FILE)
    }
  }
  else if (platform === 'android') {
    // Android keystore and service account
    if (files.ANDROID_KEYSTORE_PATH) {
      credentials.ANDROID_KEYSTORE_FILE = await fileToBase64(files.ANDROID_KEYSTORE_PATH)
    }
    if (files.PLAY_CONFIG_JSON_PATH) {
      credentials.PLAY_CONFIG_JSON = await fileToBase64(files.PLAY_CONFIG_JSON_PATH)
    }
  }

  return credentials
}

/**
 * Update saved credentials for a specific app and platform
 */
export async function updateSavedCredentials(
  appId: string,
  platform: 'ios' | 'android',
  credentials: Partial<BuildCredentials>,
  local?: boolean,
): Promise<void> {
  const all = await loadAllCredentials(local)
  const saved = all[appId] || {}

  saved[platform] = {
    ...saved[platform],
    ...credentials,
  }

  all[appId] = saved
  await saveAllCredentials(all, local)
}

/**
 * Clear saved credentials for a specific app and/or platform
 */
export async function clearSavedCredentials(appId?: string, platform?: 'ios' | 'android', local?: boolean): Promise<void> {
  const all = await loadAllCredentials(local)

  if (!appId) {
    // Clear all apps
    await saveAllCredentials({}, local)
    return
  }

  if (!platform) {
    // Clear all platforms for this app
    delete all[appId]
    await saveAllCredentials(all, local)
    return
  }

  // Clear specific platform for this app
  const saved = all[appId] || {}
  delete saved[platform]

  if (Object.keys(saved).length === 0) {
    // If no platforms left, remove the app entry
    delete all[appId]
  }
  else {
    all[appId] = saved
  }

  await saveAllCredentials(all, local)
}

/**
 * Get saved credentials for a specific app and platform
 */
export async function getSavedCredentials(appId: string, platform: 'ios' | 'android', local?: boolean): Promise<Partial<BuildCredentials> | null> {
  const saved = await loadSavedCredentials(appId, local)
  return saved?.[platform] || null
}

/**
 * List all apps that have saved credentials
 */
export async function listAllApps(local?: boolean): Promise<string[]> {
  const all = await loadAllCredentials(local)
  return Object.keys(all)
}

/**
 * Get the local credentials file path (for display purposes)
 */
export function getLocalCredentialsPath(): string {
  return join(cwd(), LOCAL_CREDENTIALS_FILE)
}

/**
 * Get the global credentials file path (for display purposes)
 */
export function getGlobalCredentialsPath(): string {
  return CREDENTIALS_FILE
}
