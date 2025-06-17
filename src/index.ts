import { program } from 'commander'
import pack from '../package.json'
import { addCommand } from './app/add'
import { debugApp } from './app/debug'
import { deleteApp } from './app/delete'
import { getInfo } from './app/info'
import { listApp } from './app/list'
import { setApp } from './app/set'
import { setSetting } from './app/setting'
import { cleanupBundle } from './bundle/cleanup'
import { checkCompatibilityCommand } from './bundle/compatibility'
import { decryptZipV2 } from './bundle/decryptV2'
import { deleteBundle } from './bundle/delete'
import { encryptZipV2 } from './bundle/encryptV2'
import { listBundle } from './bundle/list'
import { uploadCommand } from './bundle/upload'
import { zipBundle } from './bundle/zip'
import { addChannelCommand } from './channel/add'
import { currentBundle } from './channel/currentBundle'
import { deleteChannel } from './channel/delete'
import { listChannels } from './channel/list'
import { setChannel } from './channel/set'
import { generateDocs } from './docs'
import { initApp } from './init'
import { createKeyCommandV2, deleteOldKeyCommandV2, saveKeyCommandV2 } from './keyV2'
import { loginCommand } from './login'
import { getUserId } from './user/account'

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
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

program
  .command('doctor')
  .description(`👨‍⚕️ Check if your Capgo app installation is up-to-date and gather information useful for bug reports.

This command helps diagnose issues with your setup.

Example: npx @capgo/cli@latest doctor`)
  .option('--package-json <packageJson>', `A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json)`)
  .action(getInfo)

program
  .command('login [apikey]')
  .alias('l')
  .description(`🔑 Save your Capgo API key to your machine or local folder for easier access to Capgo Cloud services.

Use --apikey=******** in any command to override it.

Example: npx @capgo/cli@latest login YOUR_API_KEY`)
  .action(loginCommand)
  .option('--local', `Only save in local folder, git ignored for security.`)
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

const bundle = program
  .command('bundle')
  .description(`📦 Manage app bundles for deployment in Capgo Cloud, including upload, compatibility checks, and encryption.`)

bundle
  .command('upload [appId]')
  .alias('u')
  .description(`⬆️ Upload a new app bundle to Capgo Cloud for distribution, optionally linking to a channel or external URL.

External option supports privacy concerns or large apps (>200MB) by storing only the link.

Capgo never inspects external content. Encryption adds a trustless security layer.

Version must be > 0.0.0 and unique.

Note: External option helps with corporate privacy concerns and apps larger than 200MB by storing only the link.

Note: Capgo Cloud never looks at the content in the link for external options or in the code when stored.

Note: You can add a second layer of security with encryption, making Capgo trustless.

Note: Version should be greater than "0.0.0" and cannot be overridden or reused after deletion for security reasons.

Example: npx @capgo/cli@latest bundle upload com.example.app --path ./dist --channel production`)
  .action(uploadCommand)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('-p, --path <path>', `Path of the folder to upload, if not provided it will use the webDir set in capacitor.config`)
  .option('-c, --channel <channel>', `Channel to link to`)
  .option('-e, --external <url>', `Link to external URL instead of upload to Capgo Cloud`)
  .option('--iv-session-key <key>', `Set the IV and session key for bundle URL external`)
  .option('--s3-region <region>', `Region for your S3 bucket`)
  .option('--s3-apikey <apikey>', `API key for your S3 endpoint`)
  .option('--s3-apisecret <apisecret>', `API secret for your S3 endpoint`)
  .option('--s3-endoint <s3Endpoint>', `URL of S3 endpoint`)
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
  .option('--multipart', `Uses multipart protocol to upload data to S3, Deprecated, use tus instead`)
  .option('--zip', `Upload the bundle using zip to Capgo cloud (legacy)`)
  .option('--tus', `Upload the bundle using TUS to Capgo cloud`)
  .option('--tus-chunk-size <tusChunkSize>', `Chunk size for the TUS upload`)
  .option('--partial', `Upload partial files to Capgo cloud (deprecated, use --delta instead)`)
  .option('--partial-only', `Upload only partial files to Capgo cloud, skip the zipped file, useful for big bundle (deprecated, use --delta-only instead)`)
  .option('--delta', `Upload delta update to Capgo cloud (old name: --partial)`)
  .option('--delta-only', `Upload only delta update to Capgo cloud, skip the zipped file, useful for big bundle (old name: --partial-only)`)
  .option('--encrypted-checksum <encryptedChecksum>', `An encrypted checksum (signature). Used only when uploading an external bundle.`)
  .option('--auto-set-bundle', `Set the bundle in capacitor.config.json`)
  .option('--dry-upload', `Dry upload the bundle process, mean it will not upload the files but add the row in database (Used by Capgo for internal testing)`)
  .option('--package-json <packageJson>', `A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json)`)
  .option('--node-modules <nodeModules>', `A list of paths to node_modules. Useful for monorepos (comma separated ex: ../../node_modules,./node_modules)`)
  .option('--encrypt-partial', `Encrypt the partial update files (automatically applied for updater > 6.14.4)`)
  .option('--delete-linked-bundle-on-upload', `Locates the currently linked bundle in the channel you are trying to upload to, and deletes it`)
  .option('--no-brotli-patterns <patterns>', `Glob patterns for files to exclude from brotli compression (comma-separated)`)
  .option('--disable-brotli', `Completely disable brotli compression even if updater version supports it`)
  .option('--version-exists-ok', `Exit successfully if bundle version already exists, useful for CI/CD workflows with monorepos`)
  .option('--self-assign', `Allow device to self-assign to this channel, this will update the channel, if not provided it will leave the channel as is`)
  .option('--supa-host <supaHost>', `Supabase host URL, for self-hosted Capgo or testing`)
  .option('--supa-anon <supaAnon>', `Supabase anon token, for self-hosted Capgo or testing`)

bundle
  .command('compatibility [appId]')
  .description(`🧪 Check compatibility of a bundle with a specific channel in Capgo Cloud to ensure updates are safe.

Example: npx @capgo/cli@latest bundle compatibility com.example.app --channel production`)
  .action(checkCompatibilityCommand)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('-c, --channel <channel>', `Channel to check the compatibility with`)
  .option('--text', `Output text instead of emojis`)
  .option('--package-json <packageJson>', `A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json)`)
  .option('--node-modules <nodeModules>', `A list of paths to node_modules. Useful for monorepos (comma separated ex: ../../node_modules,./node_modules)`)
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

bundle
  .command('delete [bundleId] [appId]')
  .alias('d')
  .description(`🗑️ Delete a specific bundle from Capgo Cloud, optionally targeting a single version.

Example: npx @capgo/cli@latest bundle delete BUNDLE_ID com.example.app`)
  .action(deleteBundle)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

bundle
  .command('list [appId]')
  .alias('l')
  .description(`📋 List all bundles uploaded for an app in Capgo Cloud.

Example: npx @capgo/cli@latest bundle list com.example.app`)
  .action(listBundle)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

bundle
  .command('cleanup [appId]')
  .alias('c')
  .description(`🧹 Cleanup old bundles in Capgo Cloud, keeping a specified number of recent versions or those linked to channels.

Ignores bundles in use.

Example: npx @capgo/cli@latest bundle cleanup com.example.app --bundle=1.0 --keep=3`)
  .action(cleanupBundle)
  .option('-b, --bundle <bundle>', `Bundle version number of the app to delete`)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('-k, --keep <keep>', `Number of versions to keep`)
  .option('-f, --force', `Force removal`)
  .option('--ignore-channel', `Delete all versions even if linked to a channel, this will delete channel as well`)
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

bundle
  .command('encrypt [zipPath] [checksum]')
  .description(`🔒 Encrypt a zip bundle using the new encryption method for secure external storage or testing.

Used with external sources or for testing, prints ivSessionKey for upload or decryption.

The command will return the ivSessionKey for upload or decryption.

The checksum is the checksum of the zip file, you can get it with the --json option of the zip command.

Example: npx @capgo/cli@latest bundle encrypt ./myapp.zip CHECKSUM`)
  .action(encryptZipV2)
  .option('--key <key>', `Custom path for private signing key`)
  .option('--key-data <keyData>', `Private signing key`)
  .option('-j, --json', `Output in JSON`)

bundle
  .command('decrypt [zipPath] [checksum]')
  .description(`🔓 Decrypt a zip bundle using the new encryption method, mainly for testing purposes.

Prints the base64 decrypted session key for verification.

Example: npx @capgo/cli@latest bundle decrypt ./myapp_encrypted.zip CHECKSUM`)
  .action(decryptZipV2)
  .option('--key <key>', `Custom path for private signing key`)
  .option('--key-data <keyData>', `Private signing key`)
  .option('--checksum <checksum>', `Checksum of the bundle, to verify the integrity of the bundle`)

bundle
  .command('zip [appId]')
  .description(`🗜️ Create a zip file of your app bundle for upload or local storage.

Useful for preparing bundles before encryption or upload.

The command will return the checksum of the zip file, you can use it to encrypt the zip file with the --key-v2 option.

Example: npx @capgo/cli@latest bundle zip com.example.app --path ./dist`)
  .action(zipBundle)
  .option('-p, --path <path>', `Path of the folder to upload, if not provided it will use the webDir set in capacitor.config`)
  .option('-b, --bundle <bundle>', `Bundle version number to name the zip file`)
  .option('-n, --name <name>', `Name of the zip file`)
  .option('-j, --json', `Output in JSON`)
  .option('--no-code-check', `Ignore checking if notifyAppReady() is called in source code and index present in root folder`)
  .option('--key-v2', `Use encryption v2`)
  .option('--package-json <packageJson>', `A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json)`)

const app = program
  .command('app')
  .description(`📱 Manage your Capgo app settings and configurations in Capgo Cloud.`)

app
  .command('add [appId]')
  .alias('a')
  .description(`➕ Add a new app to Capgo Cloud with a unique app ID in the format com.test.app.

All options can be guessed from config if not provided.

Example: npx @capgo/cli@latest app add com.example.app --name "My App" --icon ./icon.png`)
  .action(addCommand)
  .option('-n, --name <name>', `App name for display in Capgo Cloud`)
  .option('-i, --icon <icon>', `App icon path for display in Capgo Cloud`)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

app
  .command('delete [appId]')
  .description(`🗑️ Delete an app from Capgo Cloud, optionally specifying a version to delete only that bundle.

Example: npx @capgo/cli@latest app delete com.example.app`)
  .action(deleteApp)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

app
  .command('list')
  .alias('l')
  .description(`📋 List all apps registered under your account in Capgo Cloud.

Example: npx @capgo/cli@latest app list`)
  .action(listApp)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

app
  .command('debug  [appId]')
  .action(debugApp)
  .description(`🐞 Listen for live update events in Capgo Cloud to debug your app.

Optionally target a specific device for detailed diagnostics.

Example: npx @capgo/cli@latest app debug com.example.app --device DEVICE_ID`)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('-d, --device <device>', `The specific device ID to debug`)
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

app
  .command('setting [path]')
  .description(`⚙️ Modify Capacitor configuration programmatically by specifying the path to the setting.

(e.g., plugins.CapacitorUpdater.defaultChannel). You MUST provide either --string or --bool.

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
  .action(setApp)
  .option('-n, --name <name>', `App name for display in Capgo Cloud`)
  .option('-i, --icon <icon>', `App icon path for display in Capgo Cloud`)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('-r, --retention <retention>', `Retention period of app bundle in days, 0 by default = infinite`)
  .option('--supa-host <supaHost>', `Supabase host URL for custom setups`)
  .option('--supa-anon <supaAnon>', `Supabase anon token for custom setups`)

const channel = program
  .command('channel')
  .description(`📢 Manage distribution channels for app updates in Capgo Cloud, controlling how updates are delivered to devices.`)

channel
  .command('add [channelId] [appId]')
  .alias('a')
  .description(`➕ Create a new channel for app distribution in Capgo Cloud to manage update delivery.

Example: npx @capgo/cli@latest channel add production com.example.app --default`)
  .action(addChannelCommand)
  .option('-d, --default', `Set the channel as default`)
  .option('--self-assign', `Allow device to self-assign to this channel`)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('--supa-host <supaHost>', `Supabase host URL, for self-hosted Capgo or testing`)
  .option('--supa-anon <supaAnon>', `Supabase anon token, for self-hosted Capgo or testing`)

channel
  .command('delete [channelId] [appId]')
  .alias('d')
  .description(`🗑️ Delete a channel from Capgo Cloud, optionally removing associated bundles to free up resources.

Example: npx @capgo/cli@latest channel delete production com.example.app`)
  .action(deleteChannel)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('--delete-bundle', `Delete the bundle associated with the channel`)
  .option('--success-if-not-found', `Success if the channel is not found`)
  .option('--supa-host <supaHost>', `Supabase host URL, for self-hosted Capgo or testing`)
  .option('--supa-anon <supaAnon>', `Supabase anon token, for self-hosted Capgo or testing`)

channel
  .command('list [appId]')
  .alias('l')
  .description(`📋 List all channels configured for an app in Capgo Cloud to review distribution settings.

Example: npx @capgo/cli@latest channel list com.example.app`)
  .action(listChannels)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('--supa-host <supaHost>', `Supabase host URL, for self-hosted Capgo or testing`)
  .option('--supa-anon <supaAnon>', `Supabase anon token, for self-hosted Capgo or testing`)

channel
  .command('currentBundle [channel] [appId]')
  .description(`📦 Get the current bundle linked to a specific channel in Capgo Cloud for update tracking.

Example: npx @capgo/cli@latest channel currentBundle production com.example.app`)
  .action(currentBundle)
  .option('-c, --channel <channel>', `Channel to get the current bundle from`)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
  .option('--quiet', `Only print the bundle version`)
  .option('--supa-host <supaHost>', `Supabase host URL, for self-hosted Capgo or testing`)
  .option('--supa-anon <supaAnon>', `Supabase anon token, for self-hosted Capgo or testing`)

channel
  .command('set [channelId] [appId]')
  .alias('s')
  .description(`⚙️ Configure settings for a channel, such as linking a bundle, setting update strategies (major, minor, metadata, patch, none), or device targeting (iOS, Android, dev, emulator).

One channel must be default.

Example: npx @capgo/cli@latest channel set production com.example.app --bundle 1.0.0 --state default`)
  .action(setChannel)
  .option('-a, --apikey <apikey>', `API key to link to your account`)
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
  .option('--disable-auto-update <disableAutoUpdate>', `Disable auto update strategy for this channel. The possible options are: major, minor, metadata, patch, none`)
  .option('--dev', `Allow sending update to development devices`)
  .option('--no-dev', `Disable sending update to development devices`)
  .option('--emulator', `Allow sending update to emulator devices`)
  .option('--no-emulator', `Disable sending update to emulator devices`)
  .option('--package-json <packageJson>', `A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json)`)
  .option('--ignore-metadata-check', `Ignore checking node_modules compatibility if present in the bundle`)
  .option('--supa-host <supaHost>', `Supabase host URL, for self-hosted Capgo or testing`)
  .option('--supa-anon <supaAnon>', `Supabase anon token, for self-hosted Capgo or testing`)

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
  .description(`🔨 Create a new encryption key pair for end-to-end encryption in Capgo Cloud.

Do not commit or share the private key; save it securely.
This command will create a new key pair with the name .capgo_key_v2 and .capgo_key_v2.pub in the root of the project.

The public key is used to decrypt the zip file in the mobile app.
The public key will also be stored in the capacitor config. This is the one used in the mobile app. The file is just a backup.

The private key is used to encrypt the zip file in the CLI.

Example: npx @capgo/cli@latest key create`)
  .action(createKeyCommandV2)
  .option('-f, --force', `Force generate a new one`)

keyV2
  .command('delete_old')
  .description(`🧹 Delete the old encryption key from the Capacitor config to ensure only the current key is used.

Example: npx @capgo/cli@latest key delete_old`)
  .action(deleteOldKeyCommandV2)

const account = program
  .command('account')
  .description(`👤 Manage your Capgo account details and retrieve information for support or collaboration.`)

account.command('id')
  .description(`🪪 Retrieve your account ID, safe to share for collaboration or support purposes in Discord or other platforms.

Example: npx @capgo/cli@latest account id`)
  .action(getUserId)
  .option('-a, --apikey <apikey>', `API key to link to your account`)

program
  .command('generate-docs [filePath]')
  .description('Generate Markdown documentation for CLI commands - either for README or individual files')
  .option('--folder <folderPath>', 'Generate individual markdown files for each command in the specified folder (instead of updating README)')
  .action((filePath, options) => {
    generateDocs(filePath, options.folder)
  })

program.parseAsync()
