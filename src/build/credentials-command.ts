import type { BuildCredentials } from './request'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { log } from '@clack/prompts'
import { createSupabaseClient, findSavedKey, getAppId, getConfig, getOrganizationId, sendEvent } from '../utils'
import {
  clearSavedCredentials,
  convertFilesToCredentials,
  getSavedCredentials,
  listAllApps,
  loadSavedCredentials,
  updateSavedCredentials,
} from './credentials'

interface SaveCredentialsOptions {
  platform?: 'ios' | 'android'
  appId?: string

  // iOS options
  certificate?: string
  provisioningProfile?: string
  provisioningProfileProd?: string
  p12Password?: string
  appleKey?: string
  appleKeyId?: string
  appleIssuerId?: string
  appleProfileName?: string
  appleTeamId?: string

  // Android options
  keystore?: string
  keystoreAlias?: string
  keystoreKeyPassword?: string
  keystoreStorePassword?: string
  playConfig?: string
}

/**
 * Save build credentials locally
 *
 * SECURITY NOTE:
 * - Credentials are saved to ~/.capgo-credentials/credentials.json on YOUR local machine only
 * - When you run a build, credentials are sent to Capgo's build servers
 * - Credentials are NEVER stored permanently on Capgo servers
 * - They are automatically deleted after build completion (max 24 hours)
 */
export async function saveCredentialsCommand(options: SaveCredentialsOptions): Promise<void> {
  try {
    if (!options.platform) {
      log.error('Platform is required. Use --platform ios or --platform android')
      process.exit(1)
    }

    // Try to infer appId from capacitor.config if not provided
    const extConfig = await getConfig()
    const appId = getAppId(options.appId, extConfig?.config)

    if (!appId) {
      log.error('❌ App ID is required.')
      log.error('')
      log.error('Either:')
      log.error('  1. Run this command from a Capacitor project directory, OR')
      log.error('  2. Provide --appId explicitly: --appId com.example.app')
      log.error('')
      process.exit(1)
    }

    const platform = options.platform

    // Display security notice
    log.info('\n🔒 SECURITY NOTICE:')
    log.info('  - Credentials saved to ~/.capgo-credentials/credentials.json (local only)')
    log.info('  - When building, credentials are sent to Capgo servers')
    log.info('  - Credentials are NEVER stored on Capgo servers')
    log.info('  - Auto-deleted after build (max 24 hours)')
    log.info('  - Builds sent directly to app stores - Capgo keeps nothing\n')

    const credentials: Partial<BuildCredentials> = {}
    const files: any = {}

    if (platform === 'ios') {
      // Handle iOS credentials
      if (options.certificate) {
        const certPath = resolve(options.certificate)
        if (!existsSync(certPath)) {
          log.error(`Certificate file not found: ${certPath}`)
          process.exit(1)
        }
        files.BUILD_CERTIFICATE_FILE = certPath
        log.info(`✓ Certificate file: ${certPath}`)
      }

      if (options.provisioningProfile) {
        const profilePath = resolve(options.provisioningProfile)
        if (!existsSync(profilePath)) {
          log.error(`Provisioning profile not found: ${profilePath}`)
          process.exit(1)
        }
        files.BUILD_PROVISION_PROFILE_FILE = profilePath
        log.info(`✓ Provisioning profile: ${profilePath}`)
      }

      if (options.provisioningProfileProd) {
        const profilePath = resolve(options.provisioningProfileProd)
        if (!existsSync(profilePath)) {
          log.error(`Production provisioning profile not found: ${profilePath}`)
          process.exit(1)
        }
        files.BUILD_PROVISION_PROFILE_FILE_PROD = profilePath
        log.info(`✓ Production provisioning profile: ${profilePath}`)
      }

      if (options.appleKey) {
        const keyPath = resolve(options.appleKey)
        if (!existsSync(keyPath)) {
          log.error(`Apple key file not found: ${keyPath}`)
          process.exit(1)
        }
        files.APPLE_KEY_FILE = keyPath
        log.info(`✓ Apple key file: ${keyPath}`)
      }

      // Passwords and IDs (not files)
      if (options.p12Password)
        credentials.P12_PASSWORD = options.p12Password
      if (options.appleKeyId)
        credentials.APPLE_KEY_ID = options.appleKeyId
      if (options.appleIssuerId)
        credentials.APPLE_ISSUER_ID = options.appleIssuerId
      if (options.appleProfileName)
        credentials.APPLE_PROFILE_NAME = options.appleProfileName
      if (options.appleTeamId)
        credentials.APP_STORE_CONNECT_TEAM_ID = options.appleTeamId
    }
    else if (platform === 'android') {
      // Handle Android credentials
      if (options.keystore) {
        const keystorePath = resolve(options.keystore)
        if (!existsSync(keystorePath)) {
          log.error(`Keystore file not found: ${keystorePath}`)
          process.exit(1)
        }
        files.ANDROID_KEYSTORE_PATH = keystorePath
        log.info(`✓ Keystore file: ${keystorePath}`)
      }

      if (options.playConfig) {
        const configPath = resolve(options.playConfig)
        if (!existsSync(configPath)) {
          log.error(`Play config file not found: ${configPath}`)
          process.exit(1)
        }
        files.PLAY_CONFIG_JSON_PATH = configPath
        log.info(`✓ Play Store config: ${configPath}`)
      }

      // Passwords and aliases (not files)
      if (options.keystoreAlias)
        credentials.KEYSTORE_KEY_ALIAS = options.keystoreAlias

      // If only one password is provided, use it for both key and store
      const hasKeyPassword = !!options.keystoreKeyPassword
      const hasStorePassword = !!options.keystoreStorePassword

      if (hasKeyPassword && !hasStorePassword) {
        // Use key password for both
        credentials.KEYSTORE_KEY_PASSWORD = options.keystoreKeyPassword
        credentials.KEYSTORE_STORE_PASSWORD = options.keystoreKeyPassword
      }
      else if (!hasKeyPassword && hasStorePassword) {
        // Use store password for both
        credentials.KEYSTORE_KEY_PASSWORD = options.keystoreStorePassword
        credentials.KEYSTORE_STORE_PASSWORD = options.keystoreStorePassword
      }
      else if (hasKeyPassword && hasStorePassword) {
        // Both provided, use separately
        credentials.KEYSTORE_KEY_PASSWORD = options.keystoreKeyPassword
        credentials.KEYSTORE_STORE_PASSWORD = options.keystoreStorePassword
      }
    }

    // Convert files to base64 and merge with other credentials
    const fileCredentials = await convertFilesToCredentials(platform, files, credentials)

    // Validate minimum required credentials for each platform
    const missingCreds: string[] = []

    if (platform === 'ios') {
      // iOS minimum requirements
      if (!fileCredentials.BUILD_CERTIFICATE_BASE64)
        missingCreds.push('--certificate <path> (P12 certificate file)')
      if (!fileCredentials.P12_PASSWORD)
        missingCreds.push('--p12-password <password> (Certificate password)')
      if (!fileCredentials.BUILD_PROVISION_PROFILE_BASE64)
        missingCreds.push('--provisioning-profile <path> (Provisioning profile file)')

      // App Store Connect API key credentials required
      if (!fileCredentials.APPLE_KEY_ID)
        missingCreds.push('--apple-key-id <id> (App Store Connect API Key ID)')
      if (!fileCredentials.APPLE_ISSUER_ID)
        missingCreds.push('--apple-issuer-id <id> (App Store Connect Issuer ID)')
      if (!fileCredentials.APPLE_KEY_CONTENT)
        missingCreds.push('--apple-key <path> (App Store Connect API Key file)')
      if (!fileCredentials.APP_STORE_CONNECT_TEAM_ID)
        missingCreds.push('--apple-team-id <id> (App Store Connect Team ID)')
    }
    else if (platform === 'android') {
      // Android minimum requirements
      if (!fileCredentials.ANDROID_KEYSTORE_FILE)
        missingCreds.push('--keystore <path> (Keystore file)')
      if (!fileCredentials.KEYSTORE_KEY_ALIAS)
        missingCreds.push('--keystore-alias <alias> (Keystore alias)')

      // For Android, we need at least one password (will be used for both if only one provided)
      if (!fileCredentials.KEYSTORE_KEY_PASSWORD && !fileCredentials.KEYSTORE_STORE_PASSWORD)
        missingCreds.push('--keystore-key-password <password> OR --keystore-store-password <password> (At least one password required, will be used for both)')

      // Google Play Store credentials (required for upload)
      if (!fileCredentials.PLAY_CONFIG_JSON)
        missingCreds.push('--play-config <path> (Google Play service account JSON - required for uploading to Play Store)')
    }

    if (missingCreds.length > 0) {
      log.error(`❌ Missing required credentials for ${platform.toUpperCase()}:`)
      log.error('')
      for (const cred of missingCreds) {
        log.error(`  • ${cred}`)
      }
      log.error('')
      log.error('Example:')
      if (platform === 'ios') {
        log.error('  npx @capgo/cli build credentials save --platform ios \\')
        log.error('    --certificate ./cert.p12 \\')
        log.error('    --p12-password "your-password" \\')
        log.error('    --provisioning-profile ./profile.mobileprovision \\')
        log.error('    --apple-key ./AuthKey_XXXXXXXXXX.p8 \\')
        log.error('    --apple-key-id "XXXXXXXXXX" \\')
        log.error('    --apple-issuer-id "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \\')
        log.error('    --apple-team-id "XXXXXXXXXX"')
      }
      else {
        log.error('  npx @capgo/cli build credentials save --platform android \\')
        log.error('    --keystore ./release.keystore \\')
        log.error('    --keystore-alias "my-key-alias" \\')
        log.error('    --keystore-key-password "password" \\')
        log.error('    --play-config ./play-store-service-account.json')
        log.error('')
        log.error('  Note: If both key and store passwords are the same, you only need to provide one.')
        log.error('        If they differ, provide both --keystore-key-password and --keystore-store-password.')
        log.error('        The --play-config is required for uploading to Google Play Store.')
      }
      log.error('')
      process.exit(1)
    }

    // Save credentials for this specific app
    await updateSavedCredentials(appId, platform, fileCredentials)

    // Send analytics event
    try {
      const apikey = findSavedKey(true)
      if (apikey) {
        const supabase = await createSupabaseClient(apikey)
        const orgId = await getOrganizationId(supabase, appId)
        await sendEvent(apikey, {
          channel: 'credentials',
          event: 'Credentials saved',
          icon: '🔐',
          user_id: orgId,
          tags: {
            'app-id': appId,
            'platform': platform,
          },
          notify: false,
        }).catch()
      }
    }
    catch {
      // Silently ignore analytics errors
    }

    log.success(`\n✅ ${platform.toUpperCase()} credentials saved successfully for ${appId}!`)
    log.info(`   Location: ~/.capgo-credentials/credentials.json`)
    log.info(`   Use: npx @capgo/cli build ${appId} --platform ${platform}\n`)
  }
  catch (error) {
    log.error(`Failed to save credentials: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

/**
 * List saved credentials (masked for security)
 */
export async function listCredentialsCommand(options?: { appId?: string }): Promise<void> {
  try {
    const appIds = await listAllApps()

    if (appIds.length === 0) {
      log.info('No saved credentials found.')
      log.info('Use: npx @capgo/cli build credentials save --platform <ios|android>')
      return
    }

    log.info('\n📋 Saved Build Credentials:\n')

    // Try to infer appId from capacitor.config if not provided
    const extConfig = await getConfig()
    const inferredAppId = options?.appId || getAppId(undefined, extConfig?.config)

    // If specific appId is provided or inferred, only show that one
    const appsToShow = inferredAppId ? [inferredAppId] : appIds

    for (const appId of appsToShow) {
      const saved = await loadSavedCredentials(appId)
      if (!saved)
        continue

      log.info(`\n🔹 App: ${appId}`)

      if (saved.ios) {
        log.info('  iOS Credentials:')
        const ios = saved.ios
        if (ios.BUILD_CERTIFICATE_BASE64)
          log.info('    ✓ Certificate (base64)')
        if (ios.BUILD_PROVISION_PROFILE_BASE64)
          log.info('    ✓ Provisioning Profile (base64)')
        if (ios.BUILD_PROVISION_PROFILE_BASE64_PROD)
          log.info('    ✓ Production Provisioning Profile (base64)')
        if (ios.APPLE_KEY_CONTENT)
          log.info('    ✓ Apple Key Content (base64)')
        if (ios.P12_PASSWORD)
          log.info('    ✓ P12 Password: ********')
        if (ios.APPLE_KEY_ID)
          log.info(`    ✓ Apple Key ID: ${ios.APPLE_KEY_ID}`)
        if (ios.APPLE_ISSUER_ID)
          log.info(`    ✓ Apple Issuer ID: ${ios.APPLE_ISSUER_ID}`)
        if (ios.APP_STORE_CONNECT_TEAM_ID)
          log.info(`    ✓ Team ID: ${ios.APP_STORE_CONNECT_TEAM_ID}`)
      }

      if (saved.android) {
        log.info('  Android Credentials:')
        const android = saved.android
        if (android.ANDROID_KEYSTORE_FILE)
          log.info('    ✓ Keystore (base64)')
        if (android.PLAY_CONFIG_JSON)
          log.info('    ✓ Play Store Config (base64)')
        if (android.KEYSTORE_KEY_ALIAS)
          log.info(`    ✓ Keystore Alias: ${android.KEYSTORE_KEY_ALIAS}`)
        if (android.KEYSTORE_KEY_PASSWORD)
          log.info('    ✓ Key Password: ********')
        if (android.KEYSTORE_STORE_PASSWORD)
          log.info('    ✓ Store Password: ********')
      }
    }

    log.info('\nLocation: ~/.capgo-credentials/credentials.json')
    log.info('\n🔒 These credentials are stored locally on your machine only.')
    log.info('   When building, they are sent to Capgo but NEVER stored there.')
    log.info('   They are auto-deleted after build completion (max 24 hours).')
    log.info('   Builds sent directly to app stores - Capgo keeps nothing.\n')
  }
  catch (error) {
    log.error(`Failed to list credentials: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

/**
 * Clear saved credentials
 */
export async function clearCredentialsCommand(options: { appId?: string, platform?: 'ios' | 'android' }): Promise<void> {
  try {
    // Try to infer appId from capacitor.config if not explicitly provided
    const extConfig = await getConfig()
    const appId = options.appId || getAppId(undefined, extConfig?.config)

    if (appId && options.platform) {
      // Clear specific platform for specific app
      const current = await getSavedCredentials(appId, options.platform)
      if (!current) {
        log.info(`No ${options.platform.toUpperCase()} credentials found for ${appId}.`)
        return
      }

      await clearSavedCredentials(appId, options.platform)
      log.success(`✅ ${options.platform.toUpperCase()} credentials cleared for ${appId}!`)
    }
    else if (appId) {
      // Clear all platforms for specific app
      const saved = await loadSavedCredentials(appId)
      if (!saved || (!saved.ios && !saved.android)) {
        log.info(`No credentials found for ${appId}.`)
        return
      }

      await clearSavedCredentials(appId)
      log.success(`✅ All credentials cleared for ${appId}!`)
    }
    else {
      // Clear everything (no appId provided or inferred)
      const appIds = await listAllApps()
      if (appIds.length === 0) {
        log.info('No saved credentials found.')
        return
      }

      await clearSavedCredentials()
      log.success('✅ All credentials cleared for all apps!')
    }

    log.info('   Location: ~/.capgo-credentials/credentials.json\n')
  }
  catch (error) {
    log.error(`Failed to clear credentials: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
