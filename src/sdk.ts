import type { Options as AppOptions } from './api/app'
import type { OptionsUpload } from './bundle/upload_interface'
import { getActiveAppVersions } from './api/versions'
import { addAppInternal } from './app/add'
import { deleteApp as deleteAppInternal } from './app/delete'
import { listApp as listAppInternal } from './app/list'
import { setApp as setAppInternal } from './app/set'
import { cleanupBundle as cleanupBundleInternal } from './bundle/cleanup'
import { deleteBundle as deleteBundleInternal } from './bundle/delete'
import { uploadBundle as uploadBundleInternal } from './bundle/upload'
import { addChannel as addChannelInternal } from './channel/add'
import { deleteChannel as deleteChannelInternal } from './channel/delete'
import { listChannels as listChannelsInternal } from './channel/list'
import { setChannel as setChannelInternal } from './channel/set'
import { createSupabaseClient, findSavedKey, getConfig } from './utils'

// ============================================================================
// Base Types
// ============================================================================

/** Common result wrapper for all SDK operations */
export interface SDKResult<T = void> {
  success: boolean
  data?: T
  error?: string
  warnings?: string[]
}

// ============================================================================
// App Management Types
// ============================================================================

export interface AddAppOptions {
  /** App ID (e.g., com.example.app) */
  appId: string
  /** App name for display in Capgo Cloud */
  name?: string
  /** App icon path for display in Capgo Cloud */
  icon?: string
  /** API key for authentication */
  apikey?: string
  /** Custom Supabase host */
  supaHost?: string
  /** Custom Supabase anon key */
  supaAnon?: string
}

export interface UpdateAppOptions {
  /** App ID (e.g., com.example.app) */
  appId: string
  /** Updated app name */
  name?: string
  /** Updated app icon path */
  icon?: string
  /** Days to keep old bundles (0 = infinite) */
  retention?: number
  /** API key for authentication */
  apikey?: string
  /** Custom Supabase host */
  supaHost?: string
  /** Custom Supabase anon key */
  supaAnon?: string
}

export interface AppInfo {
  appId: string
  name: string
  iconUrl?: string
  createdAt: Date
}

// ============================================================================
// Bundle Management Types
// ============================================================================

export interface UploadOptions {
  /** App ID (e.g., com.example.app) */
  appId: string
  /** Path to build folder */
  path: string
  /** Bundle version */
  bundle?: string
  /** Channel name */
  channel?: string
  /** API key for authentication */
  apikey?: string
  /** External URL instead of upload */
  external?: string
  /** Enable encryption */
  encrypt?: boolean
  /** Private key for encryption */
  encryptionKey?: string
  /** Custom Supabase host */
  supaHost?: string
  /** Custom Supabase anon key */
  supaAnon?: string
  /** Timeout in seconds */
  timeout?: number
  /** Use TUS protocol for upload */
  useTus?: boolean
  /** Comment for this version */
  comment?: string
  /** Minimum update version required */
  minUpdateVersion?: string
  /** Allow self-assignment to channel */
  selfAssign?: boolean
  /** Package.json paths for monorepos */
  packageJsonPaths?: string
  /** Ignore compatibility checks */
  ignoreCompatibilityCheck?: boolean
  /** Disable code check for notifyAppReady() */
  disableCodeCheck?: boolean
  /** Use legacy zip upload instead of TUS */
  useZip?: boolean
}

export interface UploadResult {
  success: boolean
  bundleId?: string
  bundleUrl?: string
  error?: string
  warnings?: string[]
}

export interface BundleInfo {
  id: string
  version: string
  channel?: string
  uploadedAt: Date
  size: number
  encrypted: boolean
}

export interface CleanupOptions {
  /** App ID */
  appId: string
  /** Number of versions to keep */
  keep?: number
  /** Bundle version pattern */
  bundle?: string
  /** Force removal without confirmation */
  force?: boolean
  /** Delete bundles even if linked to channels */
  ignoreChannel?: boolean
  /** API key for authentication */
  apikey?: string
  /** Custom Supabase host */
  supaHost?: string
  /** Custom Supabase anon key */
  supaAnon?: string
}

// ============================================================================
// Channel Management Types
// ============================================================================

export interface AddChannelOptions {
  /** Channel ID/name */
  channelId: string
  /** App ID */
  appId: string
  /** Set as default channel */
  default?: boolean
  /** Allow device self-assignment */
  selfAssign?: boolean
  /** API key for authentication */
  apikey?: string
  /** Custom Supabase host */
  supaHost?: string
  /** Custom Supabase anon key */
  supaAnon?: string
}

export interface UpdateChannelOptions {
  /** Channel ID/name */
  channelId: string
  /** App ID */
  appId: string
  /** Bundle version to link */
  bundle?: string
  /** Channel state (default or normal) */
  state?: string
  /** Allow downgrade */
  downgrade?: boolean
  /** Enable for iOS */
  ios?: boolean
  /** Enable for Android */
  android?: boolean
  /** Allow device self-assignment */
  selfAssign?: boolean
  /** Disable auto update strategy */
  disableAutoUpdate?: string
  /** Enable for dev builds */
  dev?: boolean
  /** Enable for emulators */
  emulator?: boolean
  /** API key for authentication */
  apikey?: string
  /** Custom Supabase host */
  supaHost?: string
  /** Custom Supabase anon key */
  supaAnon?: string
}

export interface ChannelInfo {
  id: string
  name: string
  appId: string
  version?: string
  createdAt: Date
  isDefault: boolean
}

// ============================================================================
// Organization Management Types
// ============================================================================

export interface AddOrganizationOptions {
  /** Organization name */
  name: string
  /** Management email */
  email: string
  /** API key for authentication */
  apikey?: string
  /** Custom Supabase host */
  supaHost?: string
  /** Custom Supabase anon key */
  supaAnon?: string
}

export interface UpdateOrganizationOptions {
  /** Organization ID */
  orgId: string
  /** Updated name */
  name?: string
  /** Updated management email */
  email?: string
  /** API key for authentication */
  apikey?: string
  /** Custom Supabase host */
  supaHost?: string
  /** Custom Supabase anon key */
  supaAnon?: string
}

export interface OrganizationInfo {
  id: string
  name: string
  email?: string
  createdAt: Date
}

// ============================================================================
// SDK Class - Main Entry Point
// ============================================================================

/**
 * Capgo SDK for programmatic access to all CLI functionality.
 * Use this class to integrate Capgo operations directly into your application.
 *
 * @example
 * ```typescript
 * // Initialize SDK
 * const sdk = new CapgoSDK({ apikey: 'your-api-key' })
 *
 * // Upload a bundle
 * const result = await sdk.uploadBundle({
 *   appId: 'com.example.app',
 *   path: './dist',
 *   bundle: '1.0.0',
 *   channel: 'production'
 * })
 *
 * if (result.success) {
 *   console.log('Upload successful!')
 * }
 * ```
 */
export class CapgoSDK {
  private readonly apikey?: string
  private readonly supaHost?: string
  private readonly supaAnon?: string

  constructor(options?: {
    apikey?: string
    supaHost?: string
    supaAnon?: string
  }) {
    this.apikey = options?.apikey
    this.supaHost = options?.supaHost
    this.supaAnon = options?.supaAnon
  }

  // ==========================================================================
  // App Management Methods
  // ==========================================================================

  /**
   * Add a new app to Capgo Cloud
   *
   * @example
   * ```typescript
   * const result = await sdk.addApp({
   *   appId: 'com.example.app',
   *   name: 'My App',
   *   icon: './icon.png'
   * })
   * ```
   */
  async addApp(options: AddAppOptions): Promise<SDKResult> {
    try {
      const internalOptions: AppOptions = {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
        name: options.name,
        icon: options.icon,
      }

      await addAppInternal(options.appId, internalOptions, undefined, true)

      return { success: true }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Update an existing app in Capgo Cloud
   *
   * Note: This method requires CLI function refactoring to work without exit().
   * Currently it will throw an error.
   *
   * @example
   * ```typescript
   * const result = await sdk.updateApp({
   *   appId: 'com.example.app',
   *   name: 'Updated App Name',
   *   retention: 30
   * })
   * ```
   */
  async updateApp(options: UpdateAppOptions): Promise<SDKResult> {
    try {
      const internalOptions: AppOptions = {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
        name: options.name,
        icon: options.icon,
        retention: options.retention,
      }

      await setAppInternal(options.appId, internalOptions, true)

      return { success: true }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Delete an app from Capgo Cloud
   *
   * @param appId - The app ID to delete
   * @param skipConfirmation - Skip owner confirmation check (use with caution)
   *
   * @example
   * ```typescript
   * const result = await sdk.deleteApp('com.example.app')
   * ```
   */
  async deleteApp(appId: string, skipConfirmation = false): Promise<SDKResult> {
    try {
      const internalOptions = {
        apikey: this.apikey || findSavedKey(true),
        supaHost: this.supaHost,
        supaAnon: this.supaAnon,
      }

      await deleteAppInternal(appId, internalOptions, false, skipConfirmation)

      return { success: true }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * List all apps for the authenticated account
   *
   * @example
   * ```typescript
   * const result = await sdk.listApps()
   * if (result.success) {
   *   result.data?.forEach(app => {
   *     console.log(`${app.name} (${app.appId})`)
   *   })
   * }
   * ```
   */
  async listApps(): Promise<SDKResult<AppInfo[]>> {
    try {
      const internalOptions = {
        apikey: this.apikey || findSavedKey(true),
        supaHost: this.supaHost,
        supaAnon: this.supaAnon,
      }

      const apps = await listAppInternal(internalOptions, false)

      const appInfos: AppInfo[] = apps.map(app => ({
        appId: app.app_id,
        name: app.name || 'Unknown',
        iconUrl: app.icon_url || undefined,
        createdAt: new Date(app.created_at || ''),
      }))

      return {
        success: true,
        data: appInfos,
      }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ==========================================================================
  // Bundle Management Methods
  // ==========================================================================

  /**
   * Upload a bundle to Capgo Cloud
   *
   * @example
   * ```typescript
   * const result = await sdk.uploadBundle({
   *   appId: 'com.example.app',
   *   path: './dist',
   *   bundle: '1.0.0',
   *   channel: 'production',
   *   comment: 'New features added'
   * })
   * ```
   */
  async uploadBundle(options: UploadOptions): Promise<UploadResult> {
    try {
      // Convert SDK options to internal format
      const internalOptions: OptionsUpload = {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
        path: options.path,
        bundle: options.bundle,
        channel: options.channel,
        external: options.external,
        key: options.encrypt !== false, // default true unless explicitly false
        keyV2: options.encryptionKey,
        timeout: options.timeout,
        tus: options.useTus,
        comment: options.comment,
        minUpdateVersion: options.minUpdateVersion,
        selfAssign: options.selfAssign,
        packageJson: options.packageJsonPaths,
        ignoreMetadataCheck: options.ignoreCompatibilityCheck,
        codeCheck: !options.disableCodeCheck, // disable if requested, otherwise check
        zip: options.useZip, // use legacy zip upload if requested
      }

      // Call internal upload function but suppress CLI behaviors
      await uploadBundleInternal(options.appId, internalOptions, false)

      return {
        success: true,
        bundleId: options.bundle,
        // Add more result data as needed
      }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * List bundles for an app
   *
   * @example
   * ```typescript
   * const result = await sdk.listBundles('com.example.app')
   * if (result.success) {
   *   result.data?.forEach(bundle => {
   *     console.log(`${bundle.version} - ${bundle.uploadedAt}`)
   *   })
   * }
   * ```
   */
  async listBundles(appId: string): Promise<SDKResult<BundleInfo[]>> {
    try {
      const apikey = this.apikey || findSavedKey(true)
      const supabase = await createSupabaseClient(apikey, this.supaHost, this.supaAnon)

      const versions = await getActiveAppVersions(supabase, appId)

      const bundles: BundleInfo[] = versions.map(bundle => ({
        id: bundle.id.toString(),
        version: bundle.name,
        uploadedAt: new Date(bundle.created_at || ''),
        size: 0, // Size not available in current schema
        encrypted: bundle.session_key !== null,
      }))

      return {
        success: true,
        data: bundles,
      }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Delete a specific bundle
   *
   * Note: This method requires CLI function refactoring to work without exit().
   *
   * @example
   * ```typescript
   * const result = await sdk.deleteBundle('com.example.app', '1.0.0')
   * ```
   */
  async deleteBundle(appId: string, bundleId: string): Promise<SDKResult> {
    try {
      const internalOptions = {
        apikey: this.apikey || findSavedKey(true),
        supaHost: this.supaHost,
        supaAnon: this.supaAnon,
        bundle: bundleId,
      }

      await deleteBundleInternal(bundleId, appId, internalOptions, true)

      return { success: true }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Cleanup old bundles, keeping only recent versions
   *
   * @example
   * ```typescript
   * const result = await sdk.cleanupBundles({
   *   appId: 'com.example.app',
   *   keep: 5,
   *   force: true
   * })
   * ```
   */
  async cleanupBundles(options: CleanupOptions): Promise<SDKResult<{ removed: number, kept: number }>> {
    try {
      const internalOptions = {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
        bundle: options.bundle || '',
        version: '',
        keep: options.keep || 4,
        force: options.force || false,
        ignoreChannel: options.ignoreChannel || false,
      }

      const result = await cleanupBundleInternal(options.appId, internalOptions, true)

      return {
        success: true,
        data: result,
      }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ==========================================================================
  // Channel Management Methods
  // ==========================================================================

  /**
   * Create a new channel for app distribution
   *
   * @example
   * ```typescript
   * const result = await sdk.addChannel({
   *   channelId: 'production',
   *   appId: 'com.example.app',
   *   default: true
   * })
   * ```
   */
  async addChannel(options: AddChannelOptions): Promise<SDKResult> {
    try {
      const internalOptions = {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
        default: options.default,
        selfAssign: options.selfAssign,
      }

      await addChannelInternal(options.channelId, options.appId, internalOptions, true)

      return { success: true }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Update channel settings
   *
   * @example
   * ```typescript
   * const result = await sdk.updateChannel({
   *   channelId: 'production',
   *   appId: 'com.example.app',
   *   bundle: '1.0.0'
   * })
   * ```
   */
  async updateChannel(options: UpdateChannelOptions): Promise<SDKResult> {
    try {
      const internalOptions = {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
        bundle: options.bundle || '',
        state: options.state,
        downgrade: options.downgrade,
        ios: options.ios,
        android: options.android,
        selfAssign: options.selfAssign,
        disableAutoUpdate: options.disableAutoUpdate || '',
        dev: options.dev,
        emulator: options.emulator,
        latest: false,
        latestRemote: false,
        packageJson: undefined,
        ignoreMetadataCheck: false,
      }

      await setChannelInternal(options.channelId, options.appId, internalOptions, true)

      return { success: true }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Delete a channel
   *
   * @example
   * ```typescript
   * const result = await sdk.deleteChannel('staging', 'com.example.app')
   * ```
   */
  async deleteChannel(channelId: string, appId: string, deleteBundle = false): Promise<SDKResult> {
    try {
      const internalOptions = {
        apikey: this.apikey || findSavedKey(true),
        supaHost: this.supaHost,
        supaAnon: this.supaAnon,
        deleteBundle,
        successIfNotFound: false,
      }

      await deleteChannelInternal(channelId, appId, internalOptions, true)

      return { success: true }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * List all channels for an app
   *
   * @example
   * ```typescript
   * const result = await sdk.listChannels('com.example.app')
   * if (result.success) {
   *   result.data?.forEach(channel => {
   *     console.log(`${channel.name} - ${channel.isDefault ? 'default' : 'normal'}`)
   *   })
   * }
   * ```
   */
  async listChannels(appId: string): Promise<SDKResult<ChannelInfo[]>> {
    try {
      const internalOptions = {
        apikey: this.apikey || findSavedKey(true),
        supaHost: this.supaHost,
        supaAnon: this.supaAnon,
      }

      const channels = await listChannelsInternal(appId, internalOptions, true)

      const channelInfos: ChannelInfo[] = channels.map((channel: any) => ({
        id: channel.id.toString(),
        name: channel.name,
        appId: channel.app_id || appId,
        version: channel.version?.name,
        createdAt: new Date(channel.created_at || Date.now()),
        isDefault: channel.public || false,
      }))

      return {
        success: true,
        data: channelInfos,
      }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ==========================================================================
  // Organization Management Methods
  // ==========================================================================

  /**
   * Create a new organization
   *
   * Note: Organization management is best done through the Capgo web dashboard.
   * This SDK method is not yet implemented. Use the CLI command instead:
   * `npx @capgo/cli organisation add`
   *
   * @example
   * ```typescript
   * // Not yet implemented - use CLI instead
   * // npx @capgo/cli organisation add --name "My Company" --email admin@company.com
   * ```
   */
  async addOrganization(_options: AddOrganizationOptions): Promise<SDKResult> {
    return {
      success: false,
      error: 'Organization management is not yet available in the SDK. Use the Capgo CLI or web dashboard instead.',
      warnings: [
        'Run: npx @capgo/cli organisation add --name "My Company" --email admin@company.com',
        'Or manage organizations at: https://web.capgo.app',
      ],
    }
  }

  /**
   * Update organization settings
   *
   * Note: Organization management is best done through the Capgo web dashboard.
   * This SDK method is not yet implemented. Use the CLI command instead:
   * `npx @capgo/cli organisation set [orgId]`
   *
   * @example
   * ```typescript
   * // Not yet implemented - use CLI instead
   * // npx @capgo/cli organisation set ORG_ID --name "Updated Name"
   * ```
   */
  async updateOrganization(_options: UpdateOrganizationOptions): Promise<SDKResult> {
    return {
      success: false,
      error: 'Organization management is not yet available in the SDK. Use the Capgo CLI or web dashboard instead.',
      warnings: [
        'Run: npx @capgo/cli organisation set ORG_ID --name "New Name"',
        'Or manage organizations at: https://web.capgo.app',
      ],
    }
  }

  /**
   * Delete an organization
   *
   * Note: Organization management is best done through the Capgo web dashboard.
   * This SDK method is not yet implemented. Use the CLI command instead:
   * `npx @capgo/cli organisation delete [orgId]`
   *
   * @example
   * ```typescript
   * // Not yet implemented - use CLI instead
   * // npx @capgo/cli organisation delete ORG_ID
   * ```
   */
  async deleteOrganization(_orgId: string): Promise<SDKResult> {
    return {
      success: false,
      error: 'Organization management is not yet available in the SDK. Use the Capgo CLI or web dashboard instead.',
      warnings: [
        'Run: npx @capgo/cli organisation delete ORG_ID',
        'Or manage organizations at: https://web.capgo.app',
        'WARNING: This action cannot be undone!',
      ],
    }
  }
}

// ============================================================================
// Functional API - Convenience Wrappers
// ============================================================================

/**
 * Upload a bundle to Capgo Cloud (functional API)
 *
 * @example
 * ```typescript
 * const result = await uploadBundle({
 *   appId: 'com.example.app',
 *   path: './dist',
 *   bundle: '1.0.0',
 *   apikey: 'your-api-key'
 * })
 * ```
 */
export async function uploadBundle(options: UploadOptions): Promise<UploadResult> {
  const sdk = new CapgoSDK({
    apikey: options.apikey,
    supaHost: options.supaHost,
    supaAnon: options.supaAnon,
  })
  return sdk.uploadBundle(options)
}

/**
 * Add a new app to Capgo Cloud (functional API)
 *
 * @example
 * ```typescript
 * const result = await addApp({
 *   appId: 'com.example.app',
 *   name: 'My App',
 *   apikey: 'your-api-key'
 * })
 * ```
 */
export async function addApp(options: AddAppOptions): Promise<SDKResult> {
  const sdk = new CapgoSDK({
    apikey: options.apikey,
    supaHost: options.supaHost,
    supaAnon: options.supaAnon,
  })
  return sdk.addApp(options)
}

/**
 * List bundles for an app (functional API)
 *
 * @example
 * ```typescript
 * const result = await listBundles('com.example.app', { apikey: 'your-api-key' })
 * ```
 */
export async function listBundles(
  appId: string,
  options?: { apikey?: string, supaHost?: string, supaAnon?: string },
): Promise<SDKResult<BundleInfo[]>> {
  const sdk = new CapgoSDK(options)
  return sdk.listBundles(appId)
}

/**
 * Add a new channel (functional API)
 *
 * @example
 * ```typescript
 * const result = await addChannel({
 *   channelId: 'production',
 *   appId: 'com.example.app',
 *   apikey: 'your-api-key'
 * })
 * ```
 */
export async function addChannel(options: AddChannelOptions): Promise<SDKResult> {
  const sdk = new CapgoSDK({
    apikey: options.apikey,
    supaHost: options.supaHost,
    supaAnon: options.supaAnon,
  })
  return sdk.addChannel(options)
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get Capacitor configuration
 *
 * @example
 * ```typescript
 * const config = await getCapacitorConfig()
 * if (config) {
 *   console.log(config.appId)
 * }
 * ```
 */
export async function getCapacitorConfig() {
  try {
    return await getConfig()
  }
  catch {
    return null
  }
}

// ============================================================================
// Re-export useful types
// ============================================================================

export type { CapacitorConfig } from './config'
export type { Database } from './types/supabase.types'
export { createSupabaseClient } from './utils'
