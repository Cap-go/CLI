import { exit } from 'node:process'
import { program } from 'commander'
import pack from '../package.json'
import { addApp } from './app/add'
import { debugApp } from './app/debug'
import { deleteApp } from './app/delete'
import { getInfo } from './app/info'
import { listApp } from './app/list'
import { setApp } from './app/set'
import { setSetting } from './app/setting'
import { requestBuildCommand } from './build/request'
import { cleanupBundle } from './bundle/cleanup'
import { checkCompatibility } from './bundle/compatibility'
import { decryptZipV2 } from './bundle/decryptV2'
import { deleteBundle } from './bundle/delete'
import { encryptZipV2 } from './bundle/encryptV2'
import { listBundle } from './bundle/list'
import { uploadBundle } from './bundle/upload'
import { zipBundle } from './bundle/zip'
import { addChannel } from './channel/add'
import { currentBundle } from './channel/currentBundle'
import { deleteChannel } from './channel/delete'
import { listChannels } from './channel/list'
import { setChannel } from './channel/set'
import { generateDocs } from './docs'
import { initApp } from './init'
import { createKeyV2, deleteOldKeyV2, saveKeyCommandV2 } from './keyV2'
import { login } from './login'
import { addOrganization, deleteOrganization, listOrganizations, setOrganization } from './organisation'
import { getUserId } from './user/account'
import { formatError } from './utils'

// Common option descriptions used across multiple commands
const optionDescriptions = {
  apikey: `API key to link to your account`,
  supaHost: `Custom Supabase host URL (for self-hosting or Capgo development)`,
  supaAnon: `Custom Supabase anon key (for self-hosting)`,
  packageJson: `Paths to package.json files for monorepos (comma-separated)`,
  nodeModules: `Paths to node_modules directories for monorepos (comma-separated)`,
  verbose: `Enable verbose output`,
}

program
  .name(pack.name)
  .description(`📦 Manage packages and bundle versions in Capgo Cloud`)
  .version(pack.version, '-v, --version', `output the current version`)

program
  .command('init [apikey] [appId]')
  .alias('i')
  .description(`🚀 Initialize a new app in Capgo Cloud with step-by-step guidance.

This includes adding code for updates, building, uploading your app, and verifying update functionality.

Example: npx @capgo/cli@latest init YOUR_API_KEY com.example.app`)
  .action(initApp)
  .option('-n, --name <name>', `App name for display in Capgo Cloud`)
  .option('-i, --icon <icon>', `App icon path for display in Capgo Cloud`)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

program
  .command('doctor')
  .description(`👨‍⚕️ Check if your Capgo app installation is up-to-date and gather information useful for bug reports.

This command helps diagnose issues with your setup.

Example: npx @capgo/cli@latest doctor`)
  .option('--package-json <packageJson>', optionDescriptions.packageJson)
  .action(async (...args) => {
    const options = args.at(-1)
    await getInfo(options)
  })

program
  .command('login [apikey]')
  .alias('l')
  .description(`🔑 Save your Capgo API key to your machine or local folder for easier access to Capgo Cloud services.

Use --apikey=******** in any command to override it.

Example: npx @capgo/cli@latest login YOUR_API_KEY`)
  .action(login)
  .option('--local', `Only save in local folder, git ignored for security.`)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

const bundle = program
  .command('bundle')
  .description(`📦 Manage app bundles for deployment in Capgo Cloud, including upload, compatibility checks, and encryption.`)

bundle
  .command('upload [appId]')
  .alias('u')
  .description(`⬆️ Upload a new app bundle to Capgo Cloud for distribution.

Version must be > 0.0.0 and unique. Deleted versions cannot be reused for security.

External option: Store only a URL link (useful for apps >200MB or privacy requirements).
Capgo never inspects external content. Add encryption for trustless security.

Example: npx @capgo/cli@latest bundle upload com.example.app --path ./dist --channel production`)
  .action(uploadBundle)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('-p, --path <path>', `Path of the folder to upload, if not provided it will use the webDir set in capacitor.config`)
  .option('-c, --channel <channel>', `Channel to link to`)
  .option('-e, --external <url>', `Link to external URL instead of upload to Capgo Cloud`)
  .option('--iv-session-key <key>', `Set the IV and session key for bundle URL external`)
  .option('--s3-region <region>', `Region for your S3 bucket`)
  .option('--s3-apikey <apikey>', `API key for your S3 endpoint`)
  .option('--s3-apisecret <apisecret>', `API secret for your S3 endpoint`)
  .option('--s3-endpoint <s3Endpoint>', `URL of S3 endpoint`)
  .option('--s3-bucket-name <bucketName>', `Name for your AWS S3 bucket`)
  .option('--s3-port <port>', `Port for your S3 endpoint`)
  .option('--no-s3-ssl', `Disable SSL for S3 upload`)
  .option('--key-v2 <key>', `Custom path for private signing key (v2 system)`)
  .option('--key-data-v2  <keyDataV2>', `Private signing key (v2 system)`)
  .option('--bundle-url', `Prints bundle URL into stdout`)
  .option('--no-key', `Ignore signing key and send clear update`)
  .option('--no-code-check', `Ignore checking if notifyAppReady() is called in source code and index present in root folder`)
  .option('--display-iv-session', `Show in the console the IV and session key used to encrypt the update`)
  .option('-b, --bundle <bundle>', `Bundle version number of the bundle to upload`)
  .option('--link <link>', `Link to external resource (e.g. GitHub release)`)
  .option('--comment <comment>', `Comment about this version, could be a release note, a commit hash, a commit message, etc.`)
  .option(
    '--min-update-version <minUpdateVersion>',
    `Minimal version required to update to this version. Used only if the disable auto update is set to metadata in channel`,
  )
  .option('--auto-min-update-version', `Set the min update version based on native packages`)
  .option('--ignore-metadata-check', `Ignores the metadata (node_modules) check when uploading`)
  .option('--ignore-checksum-check', `Ignores the checksum check when uploading`)
  .option('--timeout <timeout>', `Timeout for the upload process in seconds`)
  .option('--multipart', `[DEPRECATED] Use --tus instead. Uses multipart protocol for S3 uploads`)
  .option('--zip', `Upload the bundle using zip to Capgo cloud (legacy)`)
  .option('--tus', `Upload the bundle using TUS to Capgo cloud`)
  .option('--tus-chunk-size <tusChunkSize>', `Chunk size in bytes for TUS resumable uploads (default: auto)`)
  .option('--partial', `[DEPRECATED] Use --delta instead. Upload incremental updates`)
  .option('--partial-only', `[DEPRECATED] Use --delta-only instead. Upload only incremental updates, skip full bundle`)
  .option('--delta', `Upload incremental/differential updates to reduce bandwidth`)
  .option('--delta-only', `Upload only delta updates without full bundle (useful for large apps)`)
  .option('--encrypted-checksum <encryptedChecksum>', `An encrypted checksum (signature). Used only when uploading an external bundle.`)
  .option('--auto-set-bundle', `Set the bundle in capacitor.config.json`)
  .option('--dry-upload', `Dry upload the bundle process, mean it will not upload the files but add the row in database (Used by Capgo for internal testing)`)
  .option('--package-json <packageJson>', optionDescriptions.packageJson)
  .option('--node-modules <nodeModules>', optionDescriptions.nodeModules)
  .option('--encrypt-partial', `Encrypt delta update files (auto-enabled for updater > 6.14.4)`)
  .option('--delete-linked-bundle-on-upload', `Locates the currently linked bundle in the channel you are trying to upload to, and deletes it`)
  .option('--no-brotli-patterns <patterns>', `Files to exclude from Brotli compression (comma-separated globs, e.g., "*.jpg,*.png")`)
  .option('--disable-brotli', `Completely disable brotli compression even if updater version supports it`)
  .option('--version-exists-ok', `Exit successfully if bundle version already exists, useful for CI/CD workflows with monorepos`)
  .option('--self-assign', `Allow devices to auto-join this channel (updates channel setting)`)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)
  .option('--verbose', optionDescriptions.verbose)

bundle
  .command('compatibility [appId]')
  .description(`🧪 Check compatibility of a bundle with a specific channel in Capgo Cloud to ensure updates are safe.

Example: npx @capgo/cli@latest bundle compatibility com.example.app --channel production`)
  .action(checkCompatibility)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('-c, --channel <channel>', `Channel to check the compatibility with`)
  .option('--text', `Output text instead of emojis`)
  .option('--package-json <packageJson>', optionDescriptions.packageJson)
  .option('--node-modules <nodeModules>', optionDescriptions.nodeModules)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

bundle
  .command('delete [bundleId] [appId]')
  .alias('d')
  .description(`🗑️ Delete a specific bundle from Capgo Cloud, optionally targeting a single version.

Example: npx @capgo/cli@latest bundle delete BUNDLE_ID com.example.app`)
  .action(async (bundleId: string, appId: string, options: any) => {
    await deleteBundle(bundleId, appId, options)
  })
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

bundle
  .command('list [appId]')
  .alias('l')
  .description(`📋 List all bundles uploaded for an app in Capgo Cloud.

Example: npx @capgo/cli@latest bundle list com.example.app`)
  .action(async (appId: string, options: any) => {
    await listBundle(appId, options)
  })
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

bundle
  .command('cleanup [appId]')
  .alias('c')
  .description(`🧹 Delete old bundles in Capgo Cloud, keeping specified number of recent versions.

Bundles linked to channels are preserved unless --ignore-channel is used.

Example: npx @capgo/cli@latest bundle cleanup com.example.app --bundle=1.0 --keep=3`)
  .action(async (appId: string, options: any) => {
    await cleanupBundle(appId, options)
  })
  .option('-b, --bundle <bundle>', `Bundle version number of the app to delete`)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('-k, --keep <keep>', `Number of versions to keep`)
  .option('-f, --force', `Force removal`)
  .option('--ignore-channel', `Delete bundles even if linked to channels (WARNING: deletes channels too)`)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

bundle
  .command('encrypt [zipPath] [checksum]')
  .description(`🔒 Encrypt a zip bundle for secure external storage.

Returns ivSessionKey for upload/decryption. Get checksum using 'bundle zip --json'.

Example: npx @capgo/cli@latest bundle encrypt ./myapp.zip CHECKSUM`)
  .action(encryptZipV2)
  .option('--key <key>', `Custom path for private signing key`)
  .option('--key-data <keyData>', `Private signing key`)
  .option('-j, --json', `Output in JSON`)

bundle
  .command('decrypt [zipPath] [checksum]')
  .description(`🔓 Decrypt an encrypted bundle (mainly for testing).

Prints base64 session key for verification.

Example: npx @capgo/cli@latest bundle decrypt ./myapp_encrypted.zip CHECKSUM`)
  .action(decryptZipV2)
  .option('--key <key>', `Custom path for private signing key`)
  .option('--key-data <keyData>', `Private signing key`)
  .option('--checksum <checksum>', `Checksum of the bundle, to verify the integrity of the bundle`)

bundle
  .command('zip [appId]')
  .description(`🗜️ Create a zip file of your app bundle.

Returns checksum for use with encryption. Use --json for machine-readable output.

Example: npx @capgo/cli@latest bundle zip com.example.app --path ./dist`)
  .action(zipBundle)
  .option('-p, --path <path>', `Path of the folder to upload, if not provided it will use the webDir set in capacitor.config`)
  .option('-b, --bundle <bundle>', `Bundle version number to name the zip file`)
  .option('-n, --name <name>', `Name of the zip file`)
  .option('-j, --json', `Output in JSON`)
  .option('--no-code-check', `Ignore checking if notifyAppReady() is called in source code and index present in root folder`)
  .option('--key-v2', `Use encryption v2`)
  .option('--package-json <packageJson>', optionDescriptions.packageJson)

const app = program
  .command('app')
  .description(`📱 Manage your Capgo app settings and configurations in Capgo Cloud.`)

app
  .command('add [appId]')
  .alias('a')
  .description(`➕ Add a new app to Capgo Cloud with a unique app ID in the format com.test.app.

All options can be guessed from config if not provided.

Example: npx @capgo/cli@latest app add com.example.app --name "My App" --icon ./icon.png`)
  .action(addApp)
  .option('-n, --name <name>', `App name for display in Capgo Cloud`)
  .option('-i, --icon <icon>', `App icon path for display in Capgo Cloud`)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

app
  .command('delete [appId]')
  .description(`🗑️ Delete an app from Capgo Cloud, optionally specifying a version to delete only that bundle.

Example: npx @capgo/cli@latest app delete com.example.app`)
  .action(async (appId: string, options: any) => {
    await deleteApp(appId, options)
  })
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

app
  .command('list')
  .alias('l')
  .description(`📋 List all apps registered under your account in Capgo Cloud.

Example: npx @capgo/cli@latest app list`)
  .action(async (options: any) => {
    await listApp(options)
  })
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

app
  .command('debug  [appId]')
  .action(debugApp)
  .description(`🐞 Listen for live update events in Capgo Cloud to debug your app.

Optionally target a specific device for detailed diagnostics.

Example: npx @capgo/cli@latest app debug com.example.app --device DEVICE_ID`)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('-d, --device <device>', `The specific device ID to debug`)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

app
  .command('setting [path]')
  .description(`⚙️ Modify Capacitor configuration programmatically.

Specify setting path (e.g., plugins.CapacitorUpdater.defaultChannel) with --string or --bool.

Example: npx @capgo/cli@latest app setting plugins.CapacitorUpdater.defaultChannel --string "Production"`)
  .option('--bool <bool>', `A value for the setting to modify as a boolean, ex: --bool true`)
  .option('--string <string>', `A value for the setting to modify as a string, ex: --string "Production"`)
  .action(setSetting)

app
  .command('set [appId]')
  .alias('s')
  .description(`⚙️ Update settings for an existing app in Capgo Cloud, such as name, icon, or retention period for bundles.

Retention of 0 means infinite storage.

Example: npx @capgo/cli@latest app set com.example.app --name "Updated App" --retention 30`)
  .action(async (appId: string, options: any) => {
    await setApp(appId, options)
  })
  .option('-n, --name <name>', `App name for display in Capgo Cloud`)
  .option('-i, --icon <icon>', `App icon path for display in Capgo Cloud`)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('-r, --retention <retention>', `Days to keep old bundles (0 = infinite, default: 0)`)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

const channel = program
  .command('channel')
  .description(`📢 Manage distribution channels for app updates in Capgo Cloud, controlling how updates are delivered to devices.`)

channel
  .command('add [channelId] [appId]')
  .alias('a')
  .description(`➕ Create a new channel for app distribution in Capgo Cloud to manage update delivery.

Example: npx @capgo/cli@latest channel add production com.example.app --default`)
  .action(addChannel)
  .option('-d, --default', `Set the channel as default`)
  .option('--self-assign', `Allow device to self-assign to this channel`)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

channel
  .command('delete [channelId] [appId]')
  .alias('d')
  .description(`🗑️ Delete a channel from Capgo Cloud, optionally removing associated bundles to free up resources.

Example: npx @capgo/cli@latest channel delete production com.example.app`)
  .action(async (channelId: string, appId: string, options: any) => {
    await deleteChannel(channelId, appId, options)
  })
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--delete-bundle', `Delete the bundle associated with the channel`)
  .option('--success-if-not-found', `Success if the channel is not found`)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

channel
  .command('list [appId]')
  .alias('l')
  .description(`📋 List all channels configured for an app in Capgo Cloud to review distribution settings.

Example: npx @capgo/cli@latest channel list com.example.app`)
  .action(async (appId: string, options: any) => {
    await listChannels(appId, options)
  })
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

channel
  .command('currentBundle [channel] [appId]')
  .description(`📦 Get the current bundle linked to a specific channel in Capgo Cloud for update tracking.

Example: npx @capgo/cli@latest channel currentBundle production com.example.app`)
  .action(async (channelId: string, appId: string, options: any) => {
    await currentBundle(channelId, appId, options)
  })
  .option('-c, --channel <channel>', `Channel to get the current bundle from`)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--quiet', `Only print the bundle version`)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

channel
  .command('set [channelId] [appId]')
  .alias('s')
  .description(`⚙️ Configure settings for a channel, such as linking a bundle, setting update strategies (major, minor, metadata, patch, none), or device targeting (iOS, Android, dev, emulator).

One channel must be default.

Example: npx @capgo/cli@latest channel set production com.example.app --bundle 1.0.0 --state default`)
  .action(async (channelId: string, appId: string, options: any) => {
    await setChannel(channelId, appId, options)
  })
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('-b, --bundle <bundle>', `Bundle version number of the file to set`)
  .option('-s, --state <state>', `Set the state of the channel, default or normal`)
  .option('--latest-remote', `Get the latest bundle uploaded in capgo cloud and set it to the channel`)
  .option('--latest', `Get the latest version key in the package.json to set it to the channel`)
  .option('--downgrade', `Allow to downgrade to version under native one`)
  .option('--no-downgrade', `Disable downgrade to version under native one`)
  .option('--ios', `Allow sending update to iOS devices`)
  .option('--no-ios', `Disable sending update to iOS devices`)
  .option('--android', `Allow sending update to Android devices`)
  .option('--no-android', `Disable sending update to Android devices`)
  .option('--self-assign', `Allow device to self-assign to this channel`)
  .option('--no-self-assign', `Disable devices to self-assign to this channel`)
  .option('--disable-auto-update <disableAutoUpdate>', `Block updates by type: major, minor, metadata, patch, or none (allows all)`)
  .option('--dev', `Allow sending update to development devices`)
  .option('--no-dev', `Disable sending update to development devices`)
  .option('--emulator', `Allow sending update to emulator devices`)
  .option('--no-emulator', `Disable sending update to emulator devices`)
  .option('--package-json <packageJson>', optionDescriptions.packageJson)
  .option('--ignore-metadata-check', `Ignore checking node_modules compatibility if present in the bundle`)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

const keyV2 = program
  .command('key')
  .description(`🔐 Manage encryption keys for secure bundle distribution in Capgo Cloud, supporting end-to-end encryption with RSA and AES combination.`)

keyV2
  .command('save')
  .description(`💾 Save the public key in the Capacitor config, useful for CI environments.

Recommended not to commit the key for security.

Example: npx @capgo/cli@latest key save --key ./path/to/key.pub`)
  .action(saveKeyCommandV2)
  .option('-f, --force', `Force generate a new one`)
  .option('--key <key>', `Key path to save in Capacitor config`)
  .option('--key-data <keyData>', `Key data to save in Capacitor config`)

keyV2
  .command('create')
  .description(`🔨 Create RSA key pair for end-to-end encryption.

Creates .capgo_key_v2 (private) and .capgo_key_v2.pub (public) in project root.
Public key is saved to capacitor.config for mobile app decryption.
NEVER commit the private key - store it securely!

Example: npx @capgo/cli@latest key create`)
  .action(createKeyV2)
  .option('-f, --force', `Force generate a new one`)

keyV2
  .command('delete_old')
  .description(`🧹 Delete the old encryption key from the Capacitor config to ensure only the current key is used.

Example: npx @capgo/cli@latest key delete_old`)
  .action(deleteOldKeyV2)

const account = program
  .command('account')
  .description(`👤 Manage your Capgo account details and retrieve information for support or collaboration.`)

account.command('id')
  .description(`🪪 Retrieve your account ID, safe to share for collaboration or support purposes in Discord or other platforms.

Example: npx @capgo/cli@latest account id`)
  .action(getUserId)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)

const organisation = program
  .command('organisation')
  .description(`🏢 Manage your organizations in Capgo Cloud for team collaboration and app management.`)

organisation
  .command('list')
  .alias('l')
  .description(`📋 List all organizations you have access to in Capgo Cloud.

Example: npx @capgo/cli@latest organisation list`)
  .action(listOrganizations)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

organisation
  .command('add')
  .alias('a')
  .description(`➕ Create a new organization in Capgo Cloud for team collaboration.

Example: npx @capgo/cli@latest organisation add --name "My Company" --email admin@mycompany.com`)
  .action(addOrganization)
  .option('-n, --name <name>', `Organization name`)
  .option('-e, --email <email>', `Management email for the organization`)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

organisation
  .command('set [orgId]')
  .alias('s')
  .description(`⚙️ Update organization settings such as name and management email.

Example: npx @capgo/cli@latest organisation set ORG_ID --name "Updated Company Name"`)
  .action(setOrganization)
  .option('-n, --name <name>', `Organization name`)
  .option('-e, --email <email>', `Management email for the organization`)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

organisation
  .command('delete [orgId]')
  .alias('d')
  .description(`🗑️ Delete an organization from Capgo Cloud. This action cannot be undone.

Only organization owners can delete organizations.

Example: npx @capgo/cli@latest organisation delete ORG_ID`)
  .action(deleteOrganization)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

program
  .command('build [appId]')
  .description(`🏗️  Request a native iOS/Android build from Capgo Cloud.

⚠️ This feature is currently in PRIVATE BETA and cannot be used by anyone at this time.

This command will zip your project directory and upload it to Capgo for building.
The build will be processed in the cloud and artifacts will be available when complete.

Example: npx @capgo/cli@latest build com.example.app --platform ios --path .`)
  .action(requestBuildCommand)
  .option('--path <path>', `Path to the project directory to build (default: current directory)`)
  .option('--platform <platform>', `Target platform: ios, android, or both (default: both)`)
  .option('--build-mode <buildMode>', `Build mode: debug or release (default: release)`)
  .option('--build-config <buildConfig>', `Additional build configuration as JSON string`)
  .option('-a, --apikey <apikey>', optionDescriptions.apikey)
  .option('--supa-host <supaHost>', optionDescriptions.supaHost)
  .option('--supa-anon <supaAnon>', optionDescriptions.supaAnon)

program
  .command('generate-docs [filePath]')
  .description('Generate Markdown documentation for CLI commands - either for README or individual files')
  .option('--folder <folderPath>', 'Generate individual markdown files for each command in the specified folder (instead of updating README)')
  .action((filePath, options) => {
    generateDocs(filePath, options.folder)
  })

program.exitOverride()
program.configureOutput({
  writeErr: (_str) => {
    // Suppress Commander's default error output since we handle it in catch
  },
})

program.parseAsync().catch((error: unknown) => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const commanderError = error as { code: string, exitCode?: number, message?: string }
    // These are normal Commander.js exits (help, version, etc.) - exit silently
    if (commanderError.code === 'commander.version' || commanderError.code === 'commander.helpDisplayed') {
      exit(0)
    }
    // For actual errors, show just the message without the full stack trace
    if (commanderError.message) {
      console.error(commanderError.message)
    }
    const exitCode = commanderError.exitCode ?? 1
    exit(exitCode)
  }
  // For non-Commander errors, show full error details
  console.error(`Error: ${formatError(error)}`)
  exit(1)
})
