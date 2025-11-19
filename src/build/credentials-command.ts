import type { BuildCredentials } from './request'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { log } from '@clack/prompts'
import {
  clearSavedCredentials,
  convertFilesToCredentials,
  getSavedCredentials,
  loadSavedCredentials,
  updateSavedCredentials,
} from './credentials'

interface SaveCredentialsOptions {
  platform?: 'ios' | 'android'

  // iOS options
  certificate?: string
  provisioningProfile?: string
  provisioningProfileProd?: string
  p12Password?: string
  appleKey?: string
  appleKeyId?: string
  appleIssuerId?: string
  appleTeamId?: string
  appleId?: string
  appleAppPassword?: string

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
 * - Credentials are saved to ~/.capgo/credentials.json on YOUR local machine only
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

    const platform = options.platform

    // Display security notice
    log.info('\n🔒 SECURITY NOTICE:')
    log.info('  - Credentials saved to ~/.capgo/credentials.json (local only)')
    log.info('  - When building, credentials are sent to Capgo servers')
    log.info('  - Credentials are NEVER stored on Capgo servers')
    log.info('  - Auto-deleted after build (max 24 hours)\n')

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
      if (options.appleTeamId)
        credentials.APP_STORE_CONNECT_TEAM_ID = options.appleTeamId
      if (options.appleId)
        credentials.APPLE_ID = options.appleId
      if (options.appleAppPassword)
        credentials.APPLE_APP_SPECIFIC_PASSWORD = options.appleAppPassword
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
      if (options.keystoreKeyPassword)
        credentials.KEYSTORE_KEY_PASSWORD = options.keystoreKeyPassword
      if (options.keystoreStorePassword)
        credentials.KEYSTORE_STORE_PASSWORD = options.keystoreStorePassword
    }

    // Convert files to base64 and merge with other credentials
    const fileCredentials = await convertFilesToCredentials(platform, files, credentials)

    // Save credentials
    await updateSavedCredentials(platform, fileCredentials)

    log.success(`\n✅ ${platform.toUpperCase()} credentials saved successfully!`)
    log.info(`   Location: ~/.capgo/credentials.json`)
    log.info(`   Use: npx @capgo/cli build <appId> --platform ${platform}\n`)
  }
  catch (error) {
    log.error(`Failed to save credentials: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

/**
 * List saved credentials (masked for security)
 */
export async function listCredentialsCommand(): Promise<void> {
  try {
    const saved = await loadSavedCredentials()

    if (!saved || (!saved.ios && !saved.android)) {
      log.info('No saved credentials found.')
      log.info('Use: npx @capgo/cli build credentials save --platform <ios|android>')
      return
    }

    log.info('\n📋 Saved Build Credentials:\n')

    if (saved.ios) {
      log.info('iOS Credentials:')
      const ios = saved.ios
      if (ios.BUILD_CERTIFICATE_BASE64)
        log.info('  ✓ Certificate (base64)')
      if (ios.BUILD_PROVISION_PROFILE_BASE64)
        log.info('  ✓ Provisioning Profile (base64)')
      if (ios.BUILD_PROVISION_PROFILE_BASE64_PROD)
        log.info('  ✓ Production Provisioning Profile (base64)')
      if (ios.APPLE_KEY_CONTENT)
        log.info('  ✓ Apple Key Content (base64)')
      if (ios.P12_PASSWORD)
        log.info('  ✓ P12 Password: ********')
      if (ios.APPLE_KEY_ID)
        log.info(`  ✓ Apple Key ID: ${ios.APPLE_KEY_ID}`)
      if (ios.APPLE_ISSUER_ID)
        log.info(`  ✓ Apple Issuer ID: ${ios.APPLE_ISSUER_ID}`)
      if (ios.APP_STORE_CONNECT_TEAM_ID)
        log.info(`  ✓ Team ID: ${ios.APP_STORE_CONNECT_TEAM_ID}`)
      if (ios.APPLE_ID)
        log.info(`  ✓ Apple ID: ${ios.APPLE_ID}`)
      if (ios.APPLE_APP_SPECIFIC_PASSWORD)
        log.info('  ✓ Apple App Password: ********')
      log.info('')
    }

    if (saved.android) {
      log.info('Android Credentials:')
      const android = saved.android
      if (android.ANDROID_KEYSTORE_FILE)
        log.info('  ✓ Keystore (base64)')
      if (android.PLAY_CONFIG_JSON)
        log.info('  ✓ Play Store Config (base64)')
      if (android.KEYSTORE_KEY_ALIAS)
        log.info(`  ✓ Keystore Alias: ${android.KEYSTORE_KEY_ALIAS}`)
      if (android.KEYSTORE_KEY_PASSWORD)
        log.info('  ✓ Key Password: ********')
      if (android.KEYSTORE_STORE_PASSWORD)
        log.info('  ✓ Store Password: ********')
      log.info('')
    }

    log.info('Location: ~/.capgo/credentials.json')
    log.info('\n🔒 These credentials are stored locally on your machine only.')
    log.info('   When building, they are sent to Capgo but NEVER stored there.')
    log.info('   They are auto-deleted after build completion (max 24 hours).\n')
  }
  catch (error) {
    log.error(`Failed to list credentials: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

/**
 * Clear saved credentials
 */
export async function clearCredentialsCommand(options: { platform?: 'ios' | 'android' }): Promise<void> {
  try {
    if (options.platform) {
      const current = await getSavedCredentials(options.platform)
      if (!current) {
        log.info(`No ${options.platform.toUpperCase()} credentials found.`)
        return
      }

      await clearSavedCredentials(options.platform)
      log.success(`✅ ${options.platform.toUpperCase()} credentials cleared successfully!`)
    }
    else {
      const saved = await loadSavedCredentials()
      if (!saved || (!saved.ios && !saved.android)) {
        log.info('No saved credentials found.')
        return
      }

      await clearSavedCredentials()
      log.success('✅ All credentials cleared successfully!')
    }

    log.info('   Location: ~/.capgo/credentials.json\n')
  }
  catch (error) {
    log.error(`Failed to clear credentials: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
