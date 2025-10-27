import type { Options as AppOptions } from './api/app'
import type { Channel } from './api/channels'
import type { DecryptResult } from './bundle/decryptV2'
import type { EncryptResult } from './bundle/encryptV2'
import type { UploadBundleResult } from './bundle/upload'
import type { OptionsUpload } from './bundle/upload_interface'
import type { ZipResult } from './bundle/zip'
import type { OptionsSetChannel } from './channel/set'
import type { Organization } from './utils'
import { getActiveAppVersions } from './api/versions'
import { addAppInternal } from './app/add'
import { deleteApp as deleteAppInternal } from './app/delete'
import { getInfo as doctorInternal } from './app/info'
import { listApp as listAppInternal } from './app/list'
import { setApp as setAppInternal } from './app/set'
import { setSetting as setSettingInternal } from './app/setting'
import { cleanupBundle as cleanupBundleInternal } from './bundle/cleanup'
import { checkCompatibilityCommandInternal } from './bundle/compatibility'
import { decryptZipV2Internal } from './bundle/decryptV2'
import { deleteBundle as deleteBundleInternal } from './bundle/delete'
import { encryptZipV2Internal } from './bundle/encryptV2'
import { uploadBundle as uploadBundleInternal } from './bundle/upload'
import { zipBundleInternal } from './bundle/zip'
import { addChannel as addChannelInternal } from './channel/add'
import { currentBundle as currentBundleInternal } from './channel/currentBundle'
import { deleteChannel as deleteChannelInternal } from './channel/delete'
import { listChannels as listChannelsInternal } from './channel/list'
import { setChannel as setChannelInternal } from './channel/set'
import { createKeyV2Internal, deleteOldPrivateKeyInternal, saveKeyV2Internal } from './keyV2'
import { login as loginInternal } from './login'
import { addOrganizationInternal } from './organisation/add'
import { deleteOrganizationInternal } from './organisation/delete'
import { listOrganizationsInternal } from './organisation/list'
import { setOrganizationInternal } from './organisation/set'
import { getUserIdInternal } from './user/account'
import { createSupabaseClient, findSavedKey, getConfig } from './utils'

export type DoctorInfo = Awaited<ReturnType<typeof doctorInternal>>
type CompatibilityReport = Awaited<ReturnType<typeof checkCompatibilityCommandInternal>>['finalCompatibility']
export type BundleCompatibilityEntry = CompatibilityReport[number]

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
  checksum?: string | null
  encryptionMethod?: UploadBundleResult['encryptionMethod']
  sessionKey?: string
  ivSessionKey?: string | null
  storageProvider?: string
  skipped?: boolean
  reason?: string
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

export interface GenerateKeyOptions {
  /** Overwrite existing keys if they already exist */
  force?: boolean
  /** Automatically configure the default encryption channel instead of prompting */
  setupChannel?: boolean
}

export interface SaveKeyOptions {
  /** Path to the public key file (.pub) */
  keyPath?: string
  /** Public key contents as string (used if keyPath not provided) */
  keyData?: string
  /** Automatically configure the default encryption channel instead of prompting */
  setupChannel?: boolean
}

export interface DeleteOldKeyOptions {
  /** Force deletion if legacy files are present */
  force?: boolean
  /** Automatically configure the default encryption channel instead of prompting */
  setupChannel?: boolean
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

// ============================================================================
// Organization Management Types
// ============================================================================

export interface AccountIdOptions {
  /** API key for authentication */
  apikey?: string
  /** Custom Supabase host */
  supaHost?: string
  /** Custom Supabase anon key */
  supaAnon?: string
}

export interface ListOrganizationsOptions extends AccountIdOptions {}

export interface AddOrganizationOptions extends AccountIdOptions {
  /** Organization name */
  name: string
  /** Management email */
  email: string
}

export interface UpdateOrganizationOptions extends AccountIdOptions {
  /** Organization ID */
  orgId: string
  /** Updated name */
  name?: string
  /** Updated management email */
  email?: string
}

export interface OrganizationInfo {
  id: string
  name: string
  role?: string
  appCount?: number
  email?: string
  createdAt?: Date
}

export interface DeleteOrganizationOptions extends AccountIdOptions {
  autoConfirm?: boolean
}

export interface LoginOptions {
  apikey: string
  local?: boolean
  supaHost?: string
  supaAnon?: string
}

export interface DoctorOptions {
  packageJson?: string
}

export interface BundleCompatibilityOptions {
  appId: string
  channel: string
  packageJson?: string
  nodeModules?: string
  textOutput?: boolean
  apikey?: string
  supaHost?: string
  supaAnon?: string
}

export interface EncryptBundleOptions {
  zipPath: string
  checksum: string
  keyPath?: string
  keyData?: string
  json?: boolean
}

export interface DecryptBundleOptions {
  zipPath: string
  ivSessionKey: string
  keyPath?: string
  keyData?: string
  checksum?: string
}

export interface ZipBundleOptions {
  appId: string
  path: string
  bundle?: string
  name?: string
  codeCheck?: boolean
  json?: boolean
  keyV2?: boolean
  packageJson?: string
}

export interface CurrentBundleOptions extends AccountIdOptions {}

export interface SetSettingOptions {
  apikey?: string
  bool?: string
  string?: string
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
   * Save an API key locally or in the home directory
   */
  async login(options: LoginOptions): Promise<SDKResult> {
    try {
      await loginInternal(options.apikey, {
        local: options.local ?? false,
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
      }, true)

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
   * Run Capgo Doctor diagnostics and return the report
   */
  async doctor(options?: DoctorOptions): Promise<SDKResult<DoctorInfo>> {
    try {
      const info = await doctorInternal({ packageJson: options?.packageJson }, true)

      return {
        success: true,
        data: info,
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

  /**
   * Retrieve the account ID associated with the configured API key
   */
  async getAccountId(options?: AccountIdOptions): Promise<SDKResult<string>> {
    try {
      const resolvedOptions = {
        apikey: options?.apikey || this.apikey || findSavedKey(true),
        supaHost: options?.supaHost || this.supaHost,
        supaAnon: options?.supaAnon || this.supaAnon,
      }

      const userId = await getUserIdInternal(resolvedOptions, true)

      return {
        success: true,
        data: userId,
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

  async checkBundleCompatibility(options: BundleCompatibilityOptions): Promise<SDKResult<BundleCompatibilityEntry[]>> {
    try {
      const requestOptions = {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        channel: options.channel,
        text: options.textOutput ?? false,
        packageJson: options.packageJson,
        nodeModules: options.nodeModules,
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
      }

      const compatibility = await checkCompatibilityCommandInternal(options.appId, requestOptions, true)

      return {
        success: true,
        data: compatibility.finalCompatibility,
      }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async encryptBundle(options: EncryptBundleOptions): Promise<SDKResult<EncryptResult>> {
    try {
      const result = await encryptZipV2Internal(options.zipPath, options.checksum, {
        key: options.keyPath,
        keyData: options.keyData,
        json: options.json,
      }, true)

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

  async decryptBundle(options: DecryptBundleOptions): Promise<SDKResult<DecryptResult>> {
    try {
      const result = await decryptZipV2Internal(options.zipPath, options.ivSessionKey, {
        key: options.keyPath,
        keyData: options.keyData,
        checksum: options.checksum,
      }, true)

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

  async zipBundle(options: ZipBundleOptions): Promise<SDKResult<ZipResult>> {
    try {
      const result = await zipBundleInternal(options.appId, {
        apikey: this.apikey || findSavedKey(true),
        path: options.path,
        bundle: options.bundle,
        name: options.name,
        codeCheck: options.codeCheck,
        json: options.json,
        keyV2: options.keyV2,
        packageJson: options.packageJson,
      }, true)

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
      const uploadResponse = await uploadBundleInternal(options.appId, internalOptions, false)

      return {
        success: uploadResponse.success,
        bundleId: uploadResponse.bundle,
        checksum: uploadResponse.checksum ?? null,
        encryptionMethod: uploadResponse.encryptionMethod,
        sessionKey: uploadResponse.sessionKey,
        ivSessionKey: uploadResponse.ivSessionKey,
        storageProvider: uploadResponse.storageProvider,
        skipped: uploadResponse.skipped,
        reason: uploadResponse.reason,
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

  async getCurrentBundle(appId: string, channelId: string, options?: CurrentBundleOptions): Promise<SDKResult<string>> {
    try {
      const requestOptions = {
        apikey: options?.apikey || this.apikey || findSavedKey(true),
        quiet: true,
        supaHost: options?.supaHost || this.supaHost,
        supaAnon: options?.supaAnon || this.supaAnon,
      }

      const bundle = await currentBundleInternal(channelId, appId, requestOptions as any, true)

      return {
        success: true,
        data: bundle,
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
      const internalOptions: OptionsSetChannel = {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
        bundle: options.bundle ?? undefined,
        state: options.state,
        downgrade: options.downgrade,
        ios: options.ios,
        android: options.android,
        selfAssign: options.selfAssign,
        disableAutoUpdate: options.disableAutoUpdate ?? undefined,
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
  async listChannels(appId: string): Promise<SDKResult<Channel[]>> {
    try {
      const internalOptions = {
        apikey: this.apikey || findSavedKey(true),
        supaHost: this.supaHost,
        supaAnon: this.supaAnon,
      }

      const channels = await listChannelsInternal(appId, internalOptions, true)

      return {
        success: true,
        data: channels,
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
   * Generate Capgo encryption keys (private/public pair)
   */
  async generateEncryptionKeys(options?: GenerateKeyOptions): Promise<SDKResult> {
    try {
      await createKeyV2Internal({
        force: options?.force,
        setupChannel: options?.setupChannel,
      }, true)

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
   * Save a public encryption key into the Capacitor config
   */
  async saveEncryptionKey(options?: SaveKeyOptions): Promise<SDKResult> {
    try {
      await saveKeyV2Internal({
        key: options?.keyPath,
        keyData: options?.keyData,
        setupChannel: options?.setupChannel,
      }, true)

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
   * Delete legacy (v1) encryption keys from the project
   */
  async deleteLegacyEncryptionKey(options?: DeleteOldKeyOptions): Promise<SDKResult<{ deleted: boolean }>> {
    try {
      const deleted = await deleteOldPrivateKeyInternal({
        force: options?.force,
        setupChannel: options?.setupChannel,
      }, true)

      return {
        success: true,
        data: { deleted },
      }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async listOrganizations(options?: ListOrganizationsOptions): Promise<SDKResult<OrganizationInfo[]>> {
    try {
      const requestOptions = {
        apikey: options?.apikey || this.apikey || findSavedKey(true),
        supaHost: options?.supaHost || this.supaHost,
        supaAnon: options?.supaAnon || this.supaAnon,
      }

      const organizations = await listOrganizationsInternal(requestOptions, true)

      const data: OrganizationInfo[] = organizations.map((org: Organization) => ({
        id: String((org as any).id ?? (org as any).gid ?? ''),
        name: (org as any).name ?? 'Unknown',
        role: (org as any).role ?? undefined,
        appCount: typeof (org as any).app_count === 'number' ? (org as any).app_count : undefined,
        email: (org as any).management_email ?? undefined,
        createdAt: (org as any).created_at ? new Date((org as any).created_at) : undefined,
      }))

      return {
        success: true,
        data,
      }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async addOrganization(options: AddOrganizationOptions): Promise<SDKResult<OrganizationInfo>> {
    try {
      const requestOptions = {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
        name: options.name,
        email: options.email,
      }

      const org = await addOrganizationInternal(requestOptions, true)

      const info: OrganizationInfo = {
        id: String((org as any).id ?? (org as any).gid ?? ''),
        name: (org as any).name ?? options.name,
        role: 'owner',
        appCount: 0,
        email: (org as any).management_email ?? options.email,
        createdAt: (org as any).created_at ? new Date((org as any).created_at) : undefined,
      }

      return {
        success: true,
        data: info,
      }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateOrganization(options: UpdateOrganizationOptions): Promise<SDKResult<OrganizationInfo>> {
    try {
      const requestOptions = {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        supaHost: options.supaHost || this.supaHost,
        supaAnon: options.supaAnon || this.supaAnon,
        name: options.name,
        email: options.email,
      }

      const updated = await setOrganizationInternal(options.orgId, requestOptions, true)

      const info: OrganizationInfo = {
        id: updated.orgId,
        name: updated.name,
        email: updated.email,
      }

      return {
        success: true,
        data: info,
      }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async deleteOrganization(orgId: string, options?: DeleteOrganizationOptions): Promise<SDKResult<{ deleted: boolean }>> {
    try {
      const requestOptions = {
        apikey: options?.apikey || this.apikey || findSavedKey(true),
        supaHost: options?.supaHost || this.supaHost,
        supaAnon: options?.supaAnon || this.supaAnon,
        autoConfirm: options?.autoConfirm ?? true,
      }

      const deleted = await deleteOrganizationInternal(orgId, requestOptions, true)

      return {
        success: true,
        data: { deleted },
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
  // Miscellaneous Helpers
  // ==========================================================================

  async setAppSetting(path: string, options: SetSettingOptions): Promise<SDKResult> {
    try {
      await setSettingInternal(path, {
        apikey: options.apikey || this.apikey || findSavedKey(true),
        bool: options.bool,
        string: options.string,
      }, true)

      return { success: true }
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
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

export async function login(options: LoginOptions): Promise<SDKResult> {
  const sdk = new CapgoSDK({
    supaHost: options.supaHost,
    supaAnon: options.supaAnon,
  })
  return sdk.login(options)
}

export async function doctor(options?: DoctorOptions): Promise<SDKResult<DoctorInfo>> {
  const sdk = new CapgoSDK()
  return sdk.doctor(options)
}

export async function checkBundleCompatibility(options: BundleCompatibilityOptions): Promise<SDKResult<BundleCompatibilityEntry[]>> {
  const sdk = new CapgoSDK({
    apikey: options.apikey,
    supaHost: options.supaHost,
    supaAnon: options.supaAnon,
  })
  return sdk.checkBundleCompatibility(options)
}

export async function encryptBundle(options: EncryptBundleOptions): Promise<SDKResult<EncryptResult>> {
  const sdk = new CapgoSDK()
  return sdk.encryptBundle(options)
}

export async function decryptBundle(options: DecryptBundleOptions): Promise<SDKResult<DecryptResult>> {
  const sdk = new CapgoSDK()
  return sdk.decryptBundle(options)
}

export async function zipBundle(options: ZipBundleOptions): Promise<SDKResult<ZipResult>> {
  const sdk = new CapgoSDK()
  return sdk.zipBundle(options)
}

export async function generateEncryptionKeys(options?: GenerateKeyOptions): Promise<SDKResult> {
  const sdk = new CapgoSDK()
  return sdk.generateEncryptionKeys(options)
}

export async function saveEncryptionKey(options?: SaveKeyOptions): Promise<SDKResult> {
  const sdk = new CapgoSDK()
  return sdk.saveEncryptionKey(options)
}

export async function deleteLegacyEncryptionKey(options?: DeleteOldKeyOptions): Promise<SDKResult<{ deleted: boolean }>> {
  const sdk = new CapgoSDK()
  return sdk.deleteLegacyEncryptionKey(options)
}

export async function getCurrentBundle(appId: string, channelId: string, options?: CurrentBundleOptions): Promise<SDKResult<string>> {
  const sdk = new CapgoSDK({
    apikey: options?.apikey,
    supaHost: options?.supaHost,
    supaAnon: options?.supaAnon,
  })
  return sdk.getCurrentBundle(appId, channelId, options)
}

export async function updateAppSetting(path: string, options: SetSettingOptions): Promise<SDKResult> {
  const sdk = new CapgoSDK({
    apikey: options.apikey,
  })
  return sdk.setAppSetting(path, options)
}

export async function getAccountId(options?: AccountIdOptions): Promise<SDKResult<string>> {
  const sdk = new CapgoSDK({
    apikey: options?.apikey,
    supaHost: options?.supaHost,
    supaAnon: options?.supaAnon,
  })
  return sdk.getAccountId(options)
}

export async function listOrganizations(options?: ListOrganizationsOptions): Promise<SDKResult<OrganizationInfo[]>> {
  const sdk = new CapgoSDK({
    apikey: options?.apikey,
    supaHost: options?.supaHost,
    supaAnon: options?.supaAnon,
  })
  return sdk.listOrganizations(options)
}

export async function addOrganization(options: AddOrganizationOptions): Promise<SDKResult<OrganizationInfo>> {
  const sdk = new CapgoSDK({
    apikey: options.apikey,
    supaHost: options.supaHost,
    supaAnon: options.supaAnon,
  })
  return sdk.addOrganization(options)
}

export async function updateOrganization(options: UpdateOrganizationOptions): Promise<SDKResult<OrganizationInfo>> {
  const sdk = new CapgoSDK({
    apikey: options.apikey,
    supaHost: options.supaHost,
    supaAnon: options.supaAnon,
  })
  return sdk.updateOrganization(options)
}

export async function deleteOrganization(orgId: string, options?: DeleteOrganizationOptions): Promise<SDKResult<{ deleted: boolean }>> {
  const sdk = new CapgoSDK({
    apikey: options?.apikey,
    supaHost: options?.supaHost,
    supaAnon: options?.supaAnon,
  })
  return sdk.deleteOrganization(orgId, options)
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
