import type { BuildCredentials } from './request'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { exit } from 'node:process'
import { log } from '@clack/prompts'
import { createSupabaseClient, findSavedKey, getAppId, getConfig, getOrganizationId, sendEvent } from '../utils'
import {
  clearSavedCredentials,
  convertFilesToCredentials,
  getGlobalCredentialsPath,
  getLocalCredentialsPath,
  getSavedCredentials,
  listAllApps,
  loadSavedCredentials,
  MIN_OUTPUT_RETENTION_SECONDS,
  parseOptionalBoolean,
  parseOutputRetentionSeconds,
  updateSavedCredentials,
} from './credentials'

interface SaveCredentialsOptions {
  platform?: 'ios' | 'android'
  appId?: string
  local?: boolean

  outputUpload?: boolean
  outputRetention?: string
  skipBuildNumberBump?: boolean

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
  iosDistribution?: 'app_store' | 'ad_hoc'

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
 * - They are automatically deleted after build completion
 */
export async function saveCredentialsCommand(options: SaveCredentialsOptions): Promise<void> {
  try {
    if (!options.platform) {
      log.error('Platform is required. Use --platform ios or --platform android')
      exit(1)
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
      exit(1)
    }

    const platform = options.platform

    // Display security notice
    log.info('\n🔒 SECURITY NOTICE:')
    log.info('  - Credentials saved to ~/.capgo-credentials/credentials.json (local only)')
    log.info('  - When building, credentials are sent to Capgo servers')
    log.info('  - Credentials are NEVER stored on Capgo servers')
    log.info('  - Auto-deleted after build')
    log.info('  - Builds sent directly to app stores')
    log.info('  - Build outputs can optionally be uploaded for time-limited download links\n')

    const credentials: Partial<BuildCredentials> = {}
    const files: any = {}

    // Output upload settings: always save, inform user when defaulting
    if (options.outputUpload !== undefined) {
      credentials.BUILD_OUTPUT_UPLOAD_ENABLED = parseOptionalBoolean(options.outputUpload) ? 'true' : 'false'
    }
    else {
      credentials.BUILD_OUTPUT_UPLOAD_ENABLED = 'false'
      log.info('ℹ️  --output-upload not specified, defaulting to false (no Capgo download link)')
    }
    if (options.outputRetention) {
      credentials.BUILD_OUTPUT_RETENTION_SECONDS = String(parseOutputRetentionSeconds(options.outputRetention))
    }
    else {
      credentials.BUILD_OUTPUT_RETENTION_SECONDS = String(MIN_OUTPUT_RETENTION_SECONDS)
      log.info(`ℹ️  --output-retention not specified, defaulting to ${MIN_OUTPUT_RETENTION_SECONDS}s (1 hour)`)
    }
    if (options.skipBuildNumberBump !== undefined) {
      credentials.SKIP_BUILD_NUMBER_BUMP = parseOptionalBoolean(options.skipBuildNumberBump) ? 'true' : 'false'
    }
    else {
      log.info('ℹ️  --skip-build-number-bump not specified, build number will be auto-incremented (default)')
    }

    if (platform === 'ios') {
      // Handle iOS credentials
      if (options.certificate) {
        const certPath = resolve(options.certificate)
        if (!existsSync(certPath)) {
          log.error(`Certificate file not found: ${certPath}`)
          exit(1)
        }
        files.BUILD_CERTIFICATE_FILE = certPath
        log.info(`✓ Certificate file: ${certPath}`)
      }

      if (options.provisioningProfile) {
        const profilePath = resolve(options.provisioningProfile)
        if (!existsSync(profilePath)) {
          log.error(`Provisioning profile not found: ${profilePath}`)
          exit(1)
        }
        files.BUILD_PROVISION_PROFILE_FILE = profilePath
        log.info(`✓ Provisioning profile: ${profilePath}`)
      }

      if (options.provisioningProfileProd) {
        const profilePath = resolve(options.provisioningProfileProd)
        if (!existsSync(profilePath)) {
          log.error(`Production provisioning profile not found: ${profilePath}`)
          exit(1)
        }
        files.BUILD_PROVISION_PROFILE_FILE_PROD = profilePath
        log.info(`✓ Production provisioning profile: ${profilePath}`)
      }

      if (options.appleKey) {
        const keyPath = resolve(options.appleKey)
        if (!existsSync(keyPath)) {
          log.error(`Apple key file not found: ${keyPath}`)
          exit(1)
        }
        files.APPLE_KEY_FILE = keyPath
        log.info(`✓ Apple key file: ${keyPath}`)
      }

      // Passwords and IDs (not files)
      if (options.p12Password) {
        credentials.P12_PASSWORD = options.p12Password
      }
      else if (files.BUILD_CERTIFICATE_FILE) {
        // Warn if certificate is provided but no password
        log.warn('⚠️  No P12 password provided - assuming certificate has no password')
        log.warn('   If your certificate requires a password, add --p12-password "your-password"')
      }
      if (options.appleKeyId)
        credentials.APPLE_KEY_ID = options.appleKeyId
      if (options.appleIssuerId)
        credentials.APPLE_ISSUER_ID = options.appleIssuerId
      if (options.appleProfileName)
        credentials.APPLE_PROFILE_NAME = options.appleProfileName
      if (options.appleTeamId)
        credentials.APP_STORE_CONNECT_TEAM_ID = options.appleTeamId
      if (options.iosDistribution) {
        credentials.CAPGO_IOS_DISTRIBUTION = options.iosDistribution
      }
      else {
        credentials.CAPGO_IOS_DISTRIBUTION = 'app_store'
        log.info('ℹ️  --ios-distribution not specified, defaulting to app_store (App Store + TestFlight)')
      }
    }
    else if (platform === 'android') {
      // Handle Android credentials
      if (options.keystore) {
        const keystorePath = resolve(options.keystore)
        if (!existsSync(keystorePath)) {
          log.error(`Keystore file not found: ${keystorePath}`)
          exit(1)
        }
        files.ANDROID_KEYSTORE_PATH = keystorePath
        log.info(`✓ Keystore file: ${keystorePath}`)
      }

      if (options.playConfig) {
        const configPath = resolve(options.playConfig)
        if (!existsSync(configPath)) {
          log.error(`Play config file not found: ${configPath}`)
          exit(1)
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
      const distributionMode = (fileCredentials.CAPGO_IOS_DISTRIBUTION || 'app_store') as string

      // iOS minimum requirements (all modes)
      if (!fileCredentials.BUILD_CERTIFICATE_BASE64)
        missingCreds.push('--certificate <path> (P12 certificate file)')
      if (!fileCredentials.BUILD_PROVISION_PROFILE_BASE64)
        missingCreds.push('--provisioning-profile <path> (Provisioning profile file)')

      // App Store Connect API key: only required for app_store mode
      if (distributionMode === 'app_store') {
        const hasAppleApiKey = fileCredentials.APPLE_KEY_ID && fileCredentials.APPLE_ISSUER_ID && fileCredentials.APPLE_KEY_CONTENT
        if (!hasAppleApiKey) {
          if (fileCredentials.BUILD_OUTPUT_UPLOAD_ENABLED === 'false') {
            missingCreds.push('--apple-key/--apple-key-id/--apple-issuer-id OR --output-upload (Build has no output destination - enable either TestFlight upload or Capgo download link)')
          }
          else {
            log.warn('⚠️  App Store Connect API key not provided - TestFlight auto-upload is disabled')
            log.warn('   When building without API key, you must also set --skip-build-number-bump')
            log.warn('   To enable auto-upload, add: --apple-key ./AuthKey.p8 --apple-key-id KEY_ID --apple-issuer-id ISSUER_ID')
          }
        }
      }
      else if (distributionMode === 'ad_hoc') {
        log.info('📦 Ad-hoc distribution mode: App Store Connect API key not required')
      }

      if (!fileCredentials.APP_STORE_CONNECT_TEAM_ID)
        missingCreds.push('--apple-team-id <id> (App Store Connect Team ID)')
      if (!fileCredentials.APPLE_PROFILE_NAME)
        missingCreds.push('--apple-profile-name <name> (Provisioning profile name)')
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

      // Google Play Store credentials (optional - only needed for auto-upload to Play Store)
      if (!fileCredentials.PLAY_CONFIG_JSON) {
        if (fileCredentials.BUILD_OUTPUT_UPLOAD_ENABLED === 'false') {
          missingCreds.push('--play-config <path> OR --output-upload (Build has no output destination - enable either Play Store upload or Capgo download link)')
        }
        else {
          log.warn('⚠️  --play-config not provided - builds will succeed but cannot auto-upload to Play Store')
          log.warn('   To enable auto-upload, add: --play-config ./play-store-service-account.json')
        }
      }
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
        log.error('    --p12-password "your-password" \\  # Optional if cert has no password')
        log.error('    --provisioning-profile ./profile.mobileprovision \\')
        log.error('    --apple-team-id "XXXXXXXXXX" \\')
        log.error('    --apple-profile-name "match AppStore com.example.app" \\')
        log.error('    --output-upload')
        log.error('')
        log.error('  Optionally replace --output-upload with --apple-key, --apple-key-id, --apple-issuer-id for TestFlight auto-upload.')
      }
      else {
        log.error('  npx @capgo/cli build credentials save --platform android \\')
        log.error('    --keystore ./release.keystore \\')
        log.error('    --keystore-alias "my-key-alias" \\')
        log.error('    --keystore-key-password "password"')
        log.error('')
        log.error('  Note: If both key and store passwords are the same, you only need to provide one.')
        log.error('        If they differ, provide both --keystore-key-password and --keystore-store-password.')
        log.error('        Optionally add --play-config for auto-uploading to Google Play Store.')
      }
      log.error('')
      exit(1)
    }

    // Save credentials for this specific app
    await updateSavedCredentials(appId, platform, fileCredentials, options.local)

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
            'storage': options.local ? 'local' : 'global',
          },
          notify: false,
        }).catch()
      }
    }
    catch {
      // Silently ignore analytics errors
    }

    const credentialsPath = options.local ? getLocalCredentialsPath() : getGlobalCredentialsPath()
    log.success(`\n✅ ${platform.toUpperCase()} credentials saved successfully for ${appId}!`)
    log.info(`   Location: ${credentialsPath}`)
    log.info(`   Use: npx @capgo/cli build ${appId} --platform ${platform}\n`)
  }
  catch (error) {
    log.error(`Failed to save credentials: ${error instanceof Error ? error.message : String(error)}`)
    exit(1)
  }
}

/**
 * List saved credentials (masked for security)
 */
export async function listCredentialsCommand(options?: { appId?: string, local?: boolean }): Promise<void> {
  try {
    // If local flag is set, only show local credentials
    // Otherwise show both local and global
    const localAppIds = options?.local ? await listAllApps(true) : []
    const globalAppIds = options?.local ? [] : await listAllApps(false)
    const allAppIds = [...new Set([...localAppIds, ...globalAppIds])]

    if (allAppIds.length === 0) {
      log.info('No saved credentials found.')
      log.info('Use: npx @capgo/cli build credentials save --platform <ios|android>')
      return
    }

    log.info('\n📋 Saved Build Credentials:\n')

    // Try to infer appId from capacitor.config if not provided
    const extConfig = await getConfig()
    const inferredAppId = options?.appId || getAppId(undefined, extConfig?.config)

    // If specific appId is provided or inferred, only show that one
    const appsToShow = inferredAppId ? [inferredAppId] : allAppIds

    for (const appId of appsToShow) {
      const saved = await loadSavedCredentials(appId, options?.local)
      if (!saved)
        continue

      const isLocal = localAppIds.includes(appId)
      const locationLabel = isLocal ? ' (local)' : ' (global)'
      log.info(`\n🔹 App: ${appId}${locationLabel}`)

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
        if (ios.CAPGO_IOS_DISTRIBUTION)
          log.info(`    ✓ Distribution Mode: ${ios.CAPGO_IOS_DISTRIBUTION}`)
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

    log.info(`\nGlobal: ${getGlobalCredentialsPath()}`)
    log.info(`Local:  ${getLocalCredentialsPath()}`)
    log.info('\n🔒 These credentials are stored locally on your machine only.')
    log.info('   When building, they are sent to Capgo but NEVER stored there.\n')
  }
  catch (error) {
    log.error(`Failed to list credentials: ${error instanceof Error ? error.message : String(error)}`)
    exit(1)
  }
}

/**
 * Clear saved credentials
 */
export async function clearCredentialsCommand(options: { appId?: string, platform?: 'ios' | 'android', local?: boolean }): Promise<void> {
  try {
    // Try to infer appId from capacitor.config if not explicitly provided
    const extConfig = await getConfig()
    const appId = options.appId || getAppId(undefined, extConfig?.config)
    const credentialsPath = options.local ? getLocalCredentialsPath() : getGlobalCredentialsPath()

    if (appId && options.platform) {
      // Clear specific platform for specific app
      const current = await getSavedCredentials(appId, options.platform, options.local)
      if (!current) {
        log.info(`No ${options.platform.toUpperCase()} credentials found for ${appId}.`)
        return
      }

      await clearSavedCredentials(appId, options.platform, options.local)
      log.success(`✅ ${options.platform.toUpperCase()} credentials cleared for ${appId}!`)
    }
    else if (appId) {
      // Clear all platforms for specific app
      const saved = await loadSavedCredentials(appId, options.local)
      if (!saved || (!saved.ios && !saved.android)) {
        log.info(`No credentials found for ${appId}.`)
        return
      }

      await clearSavedCredentials(appId, undefined, options.local)
      log.success(`✅ All credentials cleared for ${appId}!`)
    }
    else {
      // Clear everything (no appId provided or inferred)
      const appIds = await listAllApps(options.local)
      if (appIds.length === 0) {
        log.info('No saved credentials found.')
        return
      }

      await clearSavedCredentials(undefined, undefined, options.local)
      log.success('✅ All credentials cleared!')
    }

    log.info(`   Location: ${credentialsPath}\n`)
  }
  catch (error) {
    log.error(`Failed to clear credentials: ${error instanceof Error ? error.message : String(error)}`)
    exit(1)
  }
}

/**
 * Update existing credentials (partial update, no full validation)
 * Use this to update specific credentials without providing all of them again
 */
export async function updateCredentialsCommand(options: SaveCredentialsOptions): Promise<void> {
  try {
    // Detect platform from provided options if not explicitly set
    const hasIosOptions = !!(options.certificate || options.provisioningProfile || options.provisioningProfileProd
      || options.p12Password || options.appleKey || options.appleKeyId || options.appleIssuerId
      || options.appleProfileName || options.appleTeamId || options.iosDistribution)
    const hasAndroidOptions = !!(options.keystore || options.keystoreAlias || options.keystoreKeyPassword
      || options.keystoreStorePassword || options.playConfig)
    const hasCrossPlatformOptions = options.outputUpload !== undefined || options.outputRetention !== undefined || options.skipBuildNumberBump !== undefined

    let platform = options.platform
    if (!platform) {
      if (hasIosOptions && !hasAndroidOptions) {
        platform = 'ios'
      }
      else if (hasAndroidOptions && !hasIosOptions) {
        platform = 'android'
      }
      else if (hasIosOptions && hasAndroidOptions) {
        log.error('Cannot mix iOS and Android options. Please use --platform to specify which platform.')
        exit(1)
      }
      else if (hasCrossPlatformOptions) {
        log.error('These options require --platform to be set (ios or android).')
        exit(1)
      }
      else {
        log.error('No credentials provided to update.')
        log.error('')
        log.error('Usage: npx @capgo/cli build credentials update [options]')
        log.error('')
        log.error('iOS options: --certificate, --provisioning-profile, --apple-key, etc.')
        log.error('Android options: --keystore, --keystore-alias, --play-config, etc.')
        exit(1)
      }
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
      exit(1)
    }

    // Check if credentials exist for this app/platform
    const existing = await getSavedCredentials(appId, platform, options.local)
    if (!existing) {
      log.error(`❌ No existing ${platform.toUpperCase()} credentials found for ${appId}.`)
      log.error('')
      log.error('Use "build credentials save" to create credentials first.')
      exit(1)
    }

    const credentials: Partial<BuildCredentials> = {}
    const files: any = {}

    if (options.outputUpload !== undefined) {
      const outputUploadEnabled = parseOptionalBoolean(options.outputUpload)
      credentials.BUILD_OUTPUT_UPLOAD_ENABLED = outputUploadEnabled ? 'true' : 'false'
    }

    if (options.outputRetention) {
      const outputRetentionSeconds = parseOutputRetentionSeconds(options.outputRetention)
      credentials.BUILD_OUTPUT_RETENTION_SECONDS = String(outputRetentionSeconds)
    }

    if (options.skipBuildNumberBump !== undefined) {
      credentials.SKIP_BUILD_NUMBER_BUMP = parseOptionalBoolean(options.skipBuildNumberBump) ? 'true' : 'false'
    }

    if (platform === 'ios') {
      // Handle iOS credentials
      if (options.certificate) {
        const certPath = resolve(options.certificate)
        if (!existsSync(certPath)) {
          log.error(`Certificate file not found: ${certPath}`)
          exit(1)
        }
        files.BUILD_CERTIFICATE_FILE = certPath
        log.info(`✓ Updating certificate: ${certPath}`)
      }

      if (options.provisioningProfile) {
        const profilePath = resolve(options.provisioningProfile)
        if (!existsSync(profilePath)) {
          log.error(`Provisioning profile not found: ${profilePath}`)
          exit(1)
        }
        files.BUILD_PROVISION_PROFILE_FILE = profilePath
        log.info(`✓ Updating provisioning profile: ${profilePath}`)
      }

      if (options.provisioningProfileProd) {
        const profilePath = resolve(options.provisioningProfileProd)
        if (!existsSync(profilePath)) {
          log.error(`Production provisioning profile not found: ${profilePath}`)
          exit(1)
        }
        files.BUILD_PROVISION_PROFILE_FILE_PROD = profilePath
        log.info(`✓ Updating production provisioning profile: ${profilePath}`)
      }

      if (options.appleKey) {
        const keyPath = resolve(options.appleKey)
        if (!existsSync(keyPath)) {
          log.error(`Apple key file not found: ${keyPath}`)
          exit(1)
        }
        files.APPLE_KEY_FILE = keyPath
        log.info(`✓ Updating Apple key file: ${keyPath}`)
      }

      // Passwords and IDs (not files)
      if (options.p12Password) {
        credentials.P12_PASSWORD = options.p12Password
        log.info('✓ Updating P12 password')
      }
      if (options.appleKeyId) {
        credentials.APPLE_KEY_ID = options.appleKeyId
        log.info(`✓ Updating Apple Key ID: ${options.appleKeyId}`)
      }
      if (options.appleIssuerId) {
        credentials.APPLE_ISSUER_ID = options.appleIssuerId
        log.info(`✓ Updating Apple Issuer ID: ${options.appleIssuerId}`)
      }
      if (options.appleProfileName) {
        credentials.APPLE_PROFILE_NAME = options.appleProfileName
        log.info(`✓ Updating Apple Profile Name: ${options.appleProfileName}`)
      }
      if (options.appleTeamId) {
        credentials.APP_STORE_CONNECT_TEAM_ID = options.appleTeamId
        log.info(`✓ Updating Apple Team ID: ${options.appleTeamId}`)
      }
      if (options.iosDistribution) {
        credentials.CAPGO_IOS_DISTRIBUTION = options.iosDistribution
        log.info(`✓ Updating iOS distribution mode: ${options.iosDistribution}`)
      }
    }
    else if (platform === 'android') {
      // Handle Android credentials
      if (options.keystore) {
        const keystorePath = resolve(options.keystore)
        if (!existsSync(keystorePath)) {
          log.error(`Keystore file not found: ${keystorePath}`)
          exit(1)
        }
        files.ANDROID_KEYSTORE_PATH = keystorePath
        log.info(`✓ Updating keystore: ${keystorePath}`)
      }

      if (options.playConfig) {
        const configPath = resolve(options.playConfig)
        if (!existsSync(configPath)) {
          log.error(`Play config file not found: ${configPath}`)
          exit(1)
        }
        files.PLAY_CONFIG_JSON_PATH = configPath
        log.info(`✓ Updating Play Store config: ${configPath}`)
      }

      // Passwords and aliases (not files)
      if (options.keystoreAlias) {
        credentials.KEYSTORE_KEY_ALIAS = options.keystoreAlias
        log.info(`✓ Updating keystore alias: ${options.keystoreAlias}`)
      }
      if (options.keystoreKeyPassword) {
        credentials.KEYSTORE_KEY_PASSWORD = options.keystoreKeyPassword
        log.info('✓ Updating keystore key password')
      }
      if (options.keystoreStorePassword) {
        credentials.KEYSTORE_STORE_PASSWORD = options.keystoreStorePassword
        log.info('✓ Updating keystore store password')
      }
    }

    // Convert files to base64 and merge with other credentials
    const fileCredentials = await convertFilesToCredentials(platform, files, credentials)

    // Update credentials (merge with existing)
    await updateSavedCredentials(appId, platform, fileCredentials, options.local)

    const credentialsPath = options.local ? getLocalCredentialsPath() : getGlobalCredentialsPath()
    log.success(`\n✅ ${platform.toUpperCase()} credentials updated for ${appId}!`)
    log.info(`   Location: ${credentialsPath}\n`)
  }
  catch (error) {
    log.error(`Failed to update credentials: ${error instanceof Error ? error.message : String(error)}`)
    exit(1)
  }
}
