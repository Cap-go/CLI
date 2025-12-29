import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import pack from '../../package.json'
import { CapgoSDK } from '../sdk'
import { findSavedKey } from '../utils'

/**
 * Start the Capgo MCP (Model Context Protocol) server.
 * This allows AI agents to interact with Capgo Cloud programmatically.
 */
export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'capgo',
    version: pack.version,
  })

  // Initialize SDK - will use saved API key or require it per-call
  const savedApiKey = findSavedKey(true)
  const sdk = new CapgoSDK({ apikey: savedApiKey })

  // ============================================================================
  // App Management Tools
  // ============================================================================

  server.tool(
    'capgo_list_apps',
    'List all apps registered in your Capgo Cloud account',
    {},
    async () => {
      const result = await sdk.listApps()
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.data, null, 2),
        }],
      }
    },
  )

  server.tool(
    'capgo_add_app',
    'Register a new app in Capgo Cloud',
    {
      appId: z.string().describe('App ID in reverse domain format (e.g., com.example.app)'),
      name: z.string().optional().describe('Display name for the app'),
      icon: z.string().optional().describe('Path to app icon file'),
    },
    async ({ appId, name, icon }) => {
      const result = await sdk.addApp({ appId, name, icon })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{ type: 'text', text: `Successfully added app: ${appId}` }],
      }
    },
  )

  server.tool(
    'capgo_update_app',
    'Update settings for an existing app in Capgo Cloud',
    {
      appId: z.string().describe('App ID to update'),
      name: z.string().optional().describe('New display name'),
      icon: z.string().optional().describe('New icon path'),
      retention: z.number().optional().describe('Days to keep old bundles (0 = infinite)'),
    },
    async ({ appId, name, icon, retention }) => {
      const result = await sdk.updateApp({ appId, name, icon, retention })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{ type: 'text', text: `Successfully updated app: ${appId}` }],
      }
    },
  )

  server.tool(
    'capgo_delete_app',
    'Delete an app from Capgo Cloud',
    {
      appId: z.string().describe('App ID to delete'),
    },
    async ({ appId }) => {
      const result = await sdk.deleteApp(appId, true) // skipConfirmation=true for non-interactive
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{ type: 'text', text: `Successfully deleted app: ${appId}` }],
      }
    },
  )

  // ============================================================================
  // Bundle Management Tools
  // ============================================================================

  server.tool(
    'capgo_upload_bundle',
    'Upload a new app bundle to Capgo Cloud for distribution',
    {
      appId: z.string().describe('App ID to upload bundle for'),
      path: z.string().describe('Path to the build folder to upload'),
      bundle: z.string().optional().describe('Bundle version number'),
      channel: z.string().optional().describe('Channel to link the bundle to'),
      comment: z.string().optional().describe('Comment or release notes for this version'),
      minUpdateVersion: z.string().optional().describe('Minimum version required to update to this version'),
      autoMinUpdateVersion: z.boolean().optional().describe('Automatically set min update version based on native packages'),
      encrypt: z.boolean().optional().describe('Enable encryption for the bundle'),
    },
    async ({ appId, path, bundle, channel, comment, minUpdateVersion, autoMinUpdateVersion, encrypt }) => {
      const result = await sdk.uploadBundle({
        appId,
        path,
        bundle,
        channel,
        comment,
        minUpdateVersion,
        autoMinUpdateVersion,
        encrypt,
      })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Bundle uploaded successfully',
            bundleId: result.bundleId,
            checksum: result.checksum,
            skipped: result.skipped,
            reason: result.reason,
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    'capgo_list_bundles',
    'List all bundles uploaded for an app',
    {
      appId: z.string().describe('App ID to list bundles for'),
    },
    async ({ appId }) => {
      const result = await sdk.listBundles(appId)
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.data, null, 2),
        }],
      }
    },
  )

  server.tool(
    'capgo_delete_bundle',
    'Delete a specific bundle from Capgo Cloud',
    {
      appId: z.string().describe('App ID'),
      bundleId: z.string().describe('Bundle version to delete'),
    },
    async ({ appId, bundleId }) => {
      const result = await sdk.deleteBundle(appId, bundleId)
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{ type: 'text', text: `Successfully deleted bundle: ${bundleId}` }],
      }
    },
  )

  server.tool(
    'capgo_cleanup_bundles',
    'Delete old bundles, keeping only recent versions',
    {
      appId: z.string().describe('App ID to cleanup bundles for'),
      keep: z.number().optional().describe('Number of versions to keep (default: 4)'),
      bundle: z.string().optional().describe('Bundle version pattern to cleanup'),
      force: z.boolean().optional().describe('Force removal without confirmation'),
      ignoreChannel: z.boolean().optional().describe('Delete bundles even if linked to channels'),
    },
    async ({ appId, keep, bundle, force, ignoreChannel }) => {
      const result = await sdk.cleanupBundles({
        appId,
        keep,
        bundle,
        force: force ?? true, // Default to true for non-interactive
        ignoreChannel,
      })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Cleanup completed',
            removed: result.data?.removed,
            kept: result.data?.kept,
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    'capgo_check_compatibility',
    'Check bundle compatibility with a specific channel',
    {
      appId: z.string().describe('App ID to check'),
      channel: z.string().describe('Channel to check compatibility with'),
      packageJson: z.string().optional().describe('Path to package.json for monorepos'),
    },
    async ({ appId, channel, packageJson }) => {
      const result = await sdk.checkBundleCompatibility({
        appId,
        channel,
        packageJson,
      })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.data, null, 2),
        }],
      }
    },
  )

  // ============================================================================
  // Channel Management Tools
  // ============================================================================

  server.tool(
    'capgo_list_channels',
    'List all channels for an app',
    {
      appId: z.string().describe('App ID to list channels for'),
    },
    async ({ appId }) => {
      const result = await sdk.listChannels(appId)
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.data, null, 2),
        }],
      }
    },
  )

  server.tool(
    'capgo_add_channel',
    'Create a new distribution channel for an app',
    {
      appId: z.string().describe('App ID'),
      channelId: z.string().describe('Channel name/ID to create'),
      default: z.boolean().optional().describe('Set as default channel'),
      selfAssign: z.boolean().optional().describe('Allow devices to self-assign to this channel'),
    },
    async ({ appId, channelId, default: isDefault, selfAssign }) => {
      const result = await sdk.addChannel({
        appId,
        channelId,
        default: isDefault,
        selfAssign,
      })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{ type: 'text', text: `Successfully created channel: ${channelId}` }],
      }
    },
  )

  server.tool(
    'capgo_update_channel',
    'Update channel settings including linked bundle and targeting options',
    {
      appId: z.string().describe('App ID'),
      channelId: z.string().describe('Channel name/ID to update'),
      bundle: z.string().optional().describe('Bundle version to link to this channel'),
      state: z.string().optional().describe('Channel state: "default" or "normal"'),
      downgrade: z.boolean().optional().describe('Allow downgrading to versions below native'),
      ios: z.boolean().optional().describe('Enable updates for iOS devices'),
      android: z.boolean().optional().describe('Enable updates for Android devices'),
      selfAssign: z.boolean().optional().describe('Allow device self-assignment'),
      disableAutoUpdate: z.string().optional().describe('Block updates by type: major, minor, metadata, patch, or none'),
      dev: z.boolean().optional().describe('Enable updates for development builds'),
      emulator: z.boolean().optional().describe('Enable updates for emulators'),
      device: z.boolean().optional().describe('Enable updates for physical devices'),
      prod: z.boolean().optional().describe('Enable updates for production builds'),
    },
    async ({ appId, channelId, bundle, state, downgrade, ios, android, selfAssign, disableAutoUpdate, dev, emulator, device, prod }) => {
      const result = await sdk.updateChannel({
        appId,
        channelId,
        bundle,
        state,
        downgrade,
        ios,
        android,
        selfAssign,
        disableAutoUpdate,
        dev,
        emulator,
        device,
        prod,
      })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{ type: 'text', text: `Successfully updated channel: ${channelId}` }],
      }
    },
  )

  server.tool(
    'capgo_delete_channel',
    'Delete a channel from an app',
    {
      appId: z.string().describe('App ID'),
      channelId: z.string().describe('Channel name/ID to delete'),
      deleteBundle: z.boolean().optional().describe('Also delete the bundle linked to this channel'),
    },
    async ({ appId, channelId, deleteBundle }) => {
      const result = await sdk.deleteChannel(channelId, appId, deleteBundle)
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{ type: 'text', text: `Successfully deleted channel: ${channelId}` }],
      }
    },
  )

  server.tool(
    'capgo_get_current_bundle',
    'Get the current bundle linked to a specific channel',
    {
      appId: z.string().describe('App ID'),
      channelId: z.string().describe('Channel name/ID'),
    },
    async ({ appId, channelId }) => {
      const result = await sdk.getCurrentBundle(appId, channelId)
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ channel: channelId, currentBundle: result.data }, null, 2),
        }],
      }
    },
  )

  // ============================================================================
  // Organization Management Tools
  // ============================================================================

  server.tool(
    'capgo_list_organizations',
    'List all organizations you have access to',
    {},
    async () => {
      const result = await sdk.listOrganizations()
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.data, null, 2),
        }],
      }
    },
  )

  server.tool(
    'capgo_add_organization',
    'Create a new organization for team collaboration',
    {
      name: z.string().describe('Organization name'),
      email: z.string().describe('Management email for the organization'),
    },
    async ({ name, email }) => {
      const result = await sdk.addOrganization({ name, email })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Organization created successfully',
            ...result.data,
          }, null, 2),
        }],
      }
    },
  )

  // ============================================================================
  // Account & Diagnostics Tools
  // ============================================================================

  server.tool(
    'capgo_get_account_id',
    'Get the account ID associated with the current API key',
    {},
    async () => {
      const result = await sdk.getAccountId()
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ accountId: result.data }, null, 2),
        }],
      }
    },
  )

  server.tool(
    'capgo_doctor',
    'Run diagnostics on the Capgo installation and get system information',
    {
      packageJson: z.string().optional().describe('Path to package.json for monorepos'),
    },
    async ({ packageJson }) => {
      const result = await sdk.doctor({ packageJson })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.data, null, 2),
        }],
      }
    },
  )

  server.tool(
    'capgo_get_stats',
    'Get device statistics and logs from Capgo backend for debugging',
    {
      appId: z.string().describe('App ID to get stats for'),
      deviceIds: z.array(z.string()).optional().describe('Filter by specific device IDs'),
      limit: z.number().optional().describe('Maximum number of results to return'),
      rangeStart: z.string().optional().describe('Start date/time for range filter (ISO string)'),
      rangeEnd: z.string().optional().describe('End date/time for range filter (ISO string)'),
    },
    async ({ appId, deviceIds, limit, rangeStart, rangeEnd }) => {
      const result = await sdk.getStats({
        appId,
        deviceIds,
        limit,
        rangeStart,
        rangeEnd,
      })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.data, null, 2),
        }],
      }
    },
  )

  // ============================================================================
  // Build Management Tools
  // ============================================================================

  server.tool(
    'capgo_request_build',
    'Request a native iOS/Android build from Capgo Cloud',
    {
      appId: z.string().describe('App ID to build'),
      platform: z.enum(['ios', 'android']).describe('Target platform'),
      path: z.string().optional().describe('Path to project directory'),
    },
    async ({ appId, platform, path }) => {
      const result = await sdk.requestBuild({
        appId,
        platform,
        path,
        // Credentials should be pre-saved using the CLI
      })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Build requested successfully',
            ...result.data,
          }, null, 2),
        }],
      }
    },
  )

  // ============================================================================
  // Encryption Key Tools
  // ============================================================================

  server.tool(
    'capgo_generate_encryption_keys',
    'Generate RSA key pair for end-to-end encryption of bundles',
    {
      force: z.boolean().optional().describe('Overwrite existing keys if they exist'),
    },
    async ({ force }) => {
      const result = await sdk.generateEncryptionKeys({ force })
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return {
        content: [{
          type: 'text',
          text: 'Encryption keys generated successfully. Private key saved to .capgo_key_v2, public key to .capgo_key_v2.pub',
        }],
      }
    },
  )

  // Start the server with stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
