/**
 * Build Credentials Management
 *
 * This module provides utilities for managing build credentials locally on your machine.
 *
 * IMPORTANT SECURITY NOTICE:
 * - Credentials are stored LOCALLY in ~/.capgo/credentials.json on YOUR machine only
 * - When you request a build, credentials are sent to Capgo's build servers
 * - Credentials are NEVER stored permanently on Capgo servers
 * - Credentials are used only during the build process and are automatically deleted
 *   from Capgo servers after the build completes (maximum 24 hours)
 * - Only build artifacts (IPA/APK files) are retained, never your credentials
 *
 * Security best practices:
 * - Ensure ~/.capgo/ directory has restricted file permissions
 * - Never commit credentials.json to version control
 * - Use separate credentials for CI/CD vs local development
 * - Rotate credentials regularly
 */

import type { BuildCredentials } from './request'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CREDENTIALS_DIR = join(homedir(), '.capgo')
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'credentials.json')

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

export interface SavedCredentials {
  ios?: Partial<BuildCredentials>
  android?: Partial<BuildCredentials>
}

/**
 * Convert a file to base64 string
 */
async function fileToBase64(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  return buffer.toString('base64')
}

/**
 * Load saved credentials from ~/.capgo/credentials.json
 */
export async function loadSavedCredentials(): Promise<SavedCredentials | null> {
  try {
    const content = await readFile(CREDENTIALS_FILE, 'utf-8')
    return JSON.parse(content) as SavedCredentials
  }
  catch {
    return null
  }
}

/**
 * Save credentials to ~/.capgo/credentials.json
 */
export async function saveCredentials(credentials: SavedCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true })
  await writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), 'utf-8')
}

/**
 * Merge saved credentials with provided credentials
 * Provided credentials take precedence
 */
export async function mergeCredentials(
  platform: 'ios' | 'android',
  provided?: BuildCredentials,
): Promise<BuildCredentials | undefined> {
  const saved = await loadSavedCredentials()

  if (!saved || !saved[platform]) {
    return provided
  }

  // Merge saved with provided, provided takes precedence
  return {
    ...saved[platform],
    ...provided,
  }
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
 * Update saved credentials for a specific platform
 */
export async function updateSavedCredentials(
  platform: 'ios' | 'android',
  credentials: Partial<BuildCredentials>,
): Promise<void> {
  const saved = await loadSavedCredentials() || {}

  saved[platform] = {
    ...saved[platform],
    ...credentials,
  }

  await saveCredentials(saved)
}

/**
 * Clear saved credentials for a specific platform
 */
export async function clearSavedCredentials(platform?: 'ios' | 'android'): Promise<void> {
  if (!platform) {
    // Clear all
    await saveCredentials({})
    return
  }

  const saved = await loadSavedCredentials() || {}
  delete saved[platform]
  await saveCredentials(saved)
}

/**
 * Get saved credentials for a specific platform
 */
export async function getSavedCredentials(platform: 'ios' | 'android'): Promise<Partial<BuildCredentials> | null> {
  const saved = await loadSavedCredentials()
  return saved?.[platform] || null
}
