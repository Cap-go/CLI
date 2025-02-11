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
import { initApp } from './init'
import { createKeyCommandV2, deleteOldKeyCommandV2, saveKeyCommandV2 } from './keyV2'

import { loginCommand } from './login'
import { getUserId } from './user/account'

program
  .name(pack.name)
  .description('Manage packages and bundle versions in Capgo Cloud')
  .version(pack.version, '-v, --version', 'output the current version')

program
  .command('login [apikey]')
  .alias('l')
  .description('Save apikey to your machine or folder')
  .action(loginCommand)
  .option('--local', 'Only save in local folder')

program
  .command('doctor')
  .description('Get info about your Capgo app install')
  .option('--package-json <packageJson>', 'A list of path to package.json. Usefull for monorepos (comma separated ex: ../../package.json,./package.json)')
  .action(getInfo)

program
  .command('init [apikey] [appId]')
  .alias('i')
  .description('Init a new app')
  .action(initApp)
  .option('-n, --name <name>', 'app name')
  .option('-i, --icon <icon>', 'app icon path')
  .option('--supa-host <supaHost>', 'Supabase host URL')
  .option('--supa-anon <supaAnon>', 'Supabase anon token')

const app = program
  .command('app')
  .description('Manage app')

app
  .command('add [appId]')
  .alias('a')
  .description('Add a new app in Capgo Cloud')
  .action(addCommand)
  .option('-n, --name <name>', 'app name')
  .option('-i, --icon <icon>', 'app icon path')
  .option('-a, --apikey <apikey>', 'apikey to link to your account')

app
  .command('delete [appId]')
  .description('Delete an app in Capgo Cloud')
  .action(deleteApp)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')

app
  .command('list')
  .alias('l')
  .description('list apps in Capgo Cloud')
  .action(listApp)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')

app
  .command('debug  [appId]')
  .description('Listen for live updates event in Capgo Cloud to debug your app')
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-d, --device <device>', 'the specific device to debug')
  .action(debugApp)

app
  .command('setting [path]')
  .description('Modifies capacitor config programmatically')
  .option('--bool <bool>', 'A value for the setting to modify as a boolean')
  .option('--string <string>', 'A value for the setting to modify as a string')
  .action(setSetting)

// app
//   .command('watch [port]')
//   .alias('w')
//   .description('watch for changes in your app and allow capgo app or your app to see changes in live')
//   .action(watchApp);

app
  .command('set [appId]')
  .alias('s')
  .description('Set an app in Capgo Cloud')
  .action(setApp)
  .option('-n, --name <name>', 'app name')
  .option('-i, --icon <icon>', 'app icon path')
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-r, --retention <retention>', 'retention period of app bundle in days')

const bundle = program
  .command('bundle')
  .description('Manage bundle')

bundle
  .command('upload [appId]')
  .alias('u')
  .description('Upload a new bundle in Capgo Cloud')
  .action(uploadCommand)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-p, --path <path>', 'path of the folder to upload, if not provided it will use the webDir set in capacitor.config')
  .option('-c, --channel <channel>', 'channel to link to')
  .option('-e, --external <url>', 'link to external url intead of upload to Capgo Cloud')
  .option('--iv-session-key <key>', 'Set the iv and session key for bundle url external')
  .option('--s3-region <region>', 'Region for your S3 bucket')
  .option('--s3-apikey <apikey>', 'Apikey for your S3 endpoint')
  .option('--s3-apisecret <apisecret>', 'Api secret for your S3 endpoint')
  .option('--s3-endoint <s3Endpoint>', 'Url of S3 endpoint')
  .option('--s3-bucket-name <bucketName>', 'Name for your AWS S3 bucket')
  .option('--s3-port <port>', 'Port for your S3 endpoint')
  .option('--no-s3-ssl', 'Disable SSL for S3 upload')
  .option('--key <key>', 'custom path for public signing key (v1 system)')
  .option('--key-data <keyData>', 'public signing key  (v1 system)')
  .option('--key-v2 <key>', 'custom path for private signing key (v2 system)')
  .option('--key-data-v2  <keyDataV2>', 'private signing key (v2 system)')
  .option('--bundle-url', 'prints bundle url into stdout')
  .option('--no-key', 'ignore signing key and send clear update')
  .option('--no-code-check', 'Ignore checking if notifyAppReady() is called in soure code and index present in root folder')
  .option('--display-iv-session', 'Show in the console the iv and session key used to encrypt the update')
  .option('-b, --bundle <bundle>', 'bundle version number of the bundle to upload')
  .option(
    '--min-update-version <minUpdateVersion>',
    'Minimal version required to update to this version. Used only if the disable auto update is set to metadata in channel',
  )
  .option('--auto-min-update-version', 'Set the min update version based on native packages')
  .option('--ignore-metadata-check', 'Ignores the metadata (node_modules) check when uploading')
  .option('--ignore-checksum-check', 'Ignores the checksum check when uploading')
  .option('--timeout <timeout>', 'Timeout for the upload process in seconds')
  .option('--multipart', 'Uses multipart protocol to upload data to S3, Deprecated, use tus instead')
  .option('--tus', 'Upload the bundle using TUS to Capgo cloud')
  .option('--tus-chunk-size <tusChunkSize>', 'Chunk size for the TUS upload')
  .option('--partial', 'Upload partial files to Capgo cloud')
  .option('--partial-only', 'Upload only partial files to Capgo cloud, skip the zipped file, useful for big bundle')
  .option('--encrypted-checksum <encryptedChecksum>', 'An encrypted checksum (signature). Used only when uploading an external bundle.')
  .option('--auto-set-bundle', 'Set the bundle in capacitor.config.json')
  .option('--dry-upload', 'Dry upload the bundle process, mean it will not upload the files but add the row in database (useful for testing)')
  .option('--package-json <packageJson>', 'A list of path to package.json. Usefull for monorepos (comma separated ex: ../../package.json,./package.json)')
  .option('--node-modules <nodeModules>', 'A list of path to node_modules. Usefull for monorepos (comma separated ex: ../../node_modules,./node_modules)')
  .option('--encrypt-partial', 'Encrypt the partial update files')
  .option('--delete-linked-bundle-on-upload', 'Locates the currently linked bundle in the channel you are trying to upload to, and deletes it')

bundle
  .command('compatibility [appId]')
  .action(checkCompatibilityCommand)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-c, --channel <channel>', 'channel to check the compatibility with')
  .option('--text', 'output text instead of emojis')
  .option('--package-json <packageJson>', 'A list of path to package.json. Usefull for monorepos (comma separated ex: ../../package.json,./package.json)')
  .option('--node-modules <nodeModules>', 'A list of path to node_modules. Usefull for monorepos (comma separated ex: ../../node_modules,./node_modules)')

bundle
  .command('delete [bundleId] [appId]')
  .alias('d')
  .description('Delete a bundle in Capgo Cloud')
  .action(deleteBundle)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')

bundle
  .command('list [appId]')
  .alias('l')
  .description('List bundle in Capgo Cloud')
  .action(listBundle)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')

// TODO: Fix this command!
// bundle
//   .command('unlink [appId]')
//   .description('Unlink a bundle in Capgo Cloud')
//   .action(listBundle)
//   .option('-a, --apikey <apikey>', 'apikey to link to your account')
//   .option('-b, --bundle <bundle>', 'bundle version number of the bundle to unlink')

bundle
  .command('cleanup [appId]')
  .alias('c')
  .action(cleanupBundle)
  .description('Cleanup bundle in Capgo Cloud')
  .option('-b, --bundle <bundle>', 'bundle version number of the app to delete')
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-k, --keep <keep>', 'number of version to keep')
  .option('-f, --force', 'force removal')

bundle
  .command('encrypt [zipPath] [checksum]')
  .description('Encrypt a zip bundle using the new encryption method')
  .action(encryptZipV2)
  .option('--key <key>', 'custom path for private signing key')
  .option('--key-data <keyData>', 'private signing key')
  .option('-j, --json', 'output in JSON')

bundle
  .command('decrypt [zipPath] [checksum]')
  .description('Decrypt a zip bundle using the new encryption method')
  .action(decryptZipV2)
  .option('--key <key>', 'custom path for private signing key')
  .option('--key-data <keyData>', 'private signing key')
  .option('--checksum <checksum>', 'checksum of the bundle, to verify the integrity of the bundle')

bundle
  .command('zip [appId]')
  .description('Zip a bundle')
  .action(zipBundle)
  .option('-p, --path <path>', 'path of the folder to upload, if not provided it will use the webDir set in capacitor.config')
  .option('-b, --bundle <bundle>', 'bundle version number to name the zip file')
  .option('-n, --name <name>', 'name of the zip file')
  .option('-j, --json', 'output in JSON')
  .option('--no-code-check', 'Ignore checking if notifyAppReady() is called in soure code and index present in root folder')
  .option('--key-v2', 'use encryption v2')
  .option('--package-json <packageJson>', 'A list of path to package.json. Usefull for monorepos (comma separated ex: ../../package.json,./package.json)')

const channel = program
  .command('channel')
  .description('Manage channel')

channel
  .command('add [channelId] [appId]')
  .alias('a')
  .description('Create channel')
  .action(addChannelCommand)
  .option('-d, --default', 'set the channel as default')
  .option('-a, --apikey <apikey>', 'apikey to link to your account')

channel
  .command('delete [channelId] [appId]')
  .alias('d')
  .description('Delete channel')
  .action(deleteChannel)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('--delete-bundle', 'delete the bundle associated with the channel')

channel
  .command('list [appId]')
  .alias('l')
  .description('List channel')
  .action(listChannels)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')

channel
  .command('currentBundle [channel] [appId]')
  .description('Get current bundle for specific channel in Capgo Cloud')
  .action(currentBundle)
  .option('-c, --channel <channel>', 'channel to get the current bundle from')
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('--quiet', 'only print the bundle version')

channel
  .command('set [channelId] [appId]')
  .alias('s')
  .description('Set channel')
  .action(setChannel)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-b, --bundle <bundle>', 'bundle version number of the file to set')
  .option('-s, --state <state>', 'set the state of the channel, default or normal')
  .option('--latest', 'get the latest version key in the package.json to set it to the channel')
  .option('--downgrade', 'Allow to downgrade to version under native one')
  .option('--no-downgrade', 'Disable downgrade to version under native one')
  .option('--upgrade', 'Allow to upgrade to version above native one')
  .option('--no-upgrade', 'Disable upgrade to version above native one')
  .option('--ios', 'Allow sending update to ios devices')
  .option('--no-ios', 'Disable sending update to ios devices')
  .option('--android', 'Allow sending update to android devices')
  .option('--no-android', 'Disable sending update to android devices')
  .option('--self-assign', 'Allow to device to self assign to this channel')
  .option('--no-self-assign', 'Disable devices to self assign to this channel')
  .option('--disable-auto-update <disableAutoUpdate>', 'Disable auto update strategy for this channel.The possible options are: major, minor, metadata, patch, none')
  .option('--dev', 'Allow sending update to development devices')
  .option('--no-dev', 'Disable sending update to development devices')
  .option('--emulator', 'Allow sending update to emulator devices')
  .option('--no-emulator', 'Disable sending update to emulator devices')
  .option('--package-json <packageJson>', 'A list of path to package.json. Usefull for monorepos (comma separated ex: ../../package.json,./package.json)')

const keyV2 = program
  .command('key')
  .description('Manage encryption key')

keyV2
  .command('save')
  .description('Save base64 encryption key in capacitor config, usefull for CI')
  .action(saveKeyCommandV2)
  .option('-f, --force', 'force generate a new one')
  .option('--key', 'key path to save in capacitor config')
  .option('--key-data', 'key data to save in capacitor config')

keyV2
  .command('create')
  .description('Create a new encryption key')
  .action(createKeyCommandV2)
  .option('-f, --force', 'force generate a new one')

keyV2
  .command('delete_old')
  .description('Delete the old encryption key')
  .action(deleteOldKeyCommandV2)

const account = program
  .command('account')
  .description('Manage account')

account.command('id')
  .description('Get your account ID, it\'s safe to share it in discord or other places')
  .action(getUserId)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')

program.parseAsync()
