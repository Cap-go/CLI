import type { OptionsUpload } from './bundle/upload_interface'
import { uploadBundle as uploadBundleInternal } from './bundle/upload'
import { createSupabaseClient, findSavedKey, getConfig } from './utils'

// Clean interfaces for SDK consumers
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

// SDK class for programmatic access
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

  /**
   * Upload a bundle to Capgo Cloud
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
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
        codeCheck: true, // always check by default in SDK
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
   */
  async listBundles(appId: string): Promise<BundleInfo[]> {
    const apikey = this.apikey || findSavedKey(true)
    const supabase = await createSupabaseClient(apikey, this.supaHost, this.supaAnon)

    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .eq('app_id', appId)
      .eq('deleted', false)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Failed to list bundles: ${error.message}`)
    }

    return data.map(bundle => ({
      id: bundle.id.toString(),
      version: bundle.name,
      uploadedAt: new Date(bundle.created_at || ''),
      size: 0, // Size not available in current schema
      encrypted: bundle.session_key !== null,
    }))
  }

  /**
   * Delete a bundle
   */
  async deleteBundle(appId: string, bundleId: string): Promise<void> {
    const apikey = this.apikey || findSavedKey(true)
    const supabase = await createSupabaseClient(apikey, this.supaHost, this.supaAnon)

    const { error } = await supabase
      .from('app_versions')
      .update({ deleted: true })
      .eq('app_id', appId)
      .eq('name', bundleId)

    if (error) {
      throw new Error(`Failed to delete bundle: ${error.message}`)
    }
  }
}

// Functional API for simple use cases
export async function uploadBundle(options: UploadOptions): Promise<UploadResult> {
  const sdk = new CapgoSDK({
    apikey: options.apikey,
    supaHost: options.supaHost,
    supaAnon: options.supaAnon,
  })
  return sdk.upload(options)
}

// Utility functions
export async function getCapacitorConfig() {
  try {
    return await getConfig()
  }
  catch {
    return null
  }
}

// Re-export types that might be useful
export type { CapacitorConfig } from './config'

export type { Database } from './types/supabase.types'
export { createSupabaseClient } from './utils'
