import { program } from 'commander'
import pack from '../package.json'
import { zipBundle } from './bundle/zip'
import { initApp } from './init'
import { listBundle } from './bundle/list'
import { decryptZip } from './bundle/decrypt'
import { encryptZip } from './bundle/encrypt'
import { addCommand } from './app/add'
import { getInfo } from './app/info'
import { createKeyCommand, saveKeyCommand } from './key'
import { deleteBundle } from './bundle/delete'
import { setChannel } from './channel/set'
import { currentBundle } from './channel/currentBundle'
import { uploadCommand, uploadDeprecatedCommand } from './bundle/upload'
import { loginCommand } from './login'
import { listApp } from './app/list'
import { cleanupBundle } from './bundle/cleanup'
import { addChannelCommand } from './channel/add'
import { deleteChannel } from './channel/delete'
import { listChannels } from './channel/list'
import { setApp } from './app/set'
import { deleteApp } from './app/delete'

// import { watchApp } from './app/watch';
import { debugApp } from './app/debug'
import { checkCompatibilityCommand } from './bundle/compatibility'

program
  .name(pack.name)
  .description('Manage packages and bundle versions in Capgo Cloud')
  .version(pack.version)

program
  .command('login [apikey]')
  .alias('l')
  .description('Save apikey to your machine or folder')
  .action(loginCommand)
  .option('--local', 'Only save in local folder')

program
  .command('doctor')
  .description('Get info about your Capgo app install')
  .action(getInfo)

program
  .command('init [apikey] [appId]')
  .description('Init a new app')
  .action(initApp)
  .option('-n, --name <name>', 'app name')
  .option('-i, --icon <icon>', 'app icon path')
  .option('-a, --apikey <apikey>', 'apikey to link to your account')

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
  .option('-p, --path <path>', 'path of the folder to upload')
  .option('-c, --channel <channel>', 'channel to link to')
  .option('-e, --external <url>', 'link to external url intead of upload to Capgo Cloud')
  .option('--iv-session-key <key>', 'Set the iv and session key for bundle url external')
  .option('--key <key>', 'custom path for public signing key')
  .option('--key-data <keyData>', 'base64 public signing key')
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

bundle
  .command('compatibility [appId]')
  .action(checkCompatibilityCommand)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-c, --channel <channel>', 'channel to check the compatibility with')
  .option('--text', 'output text instead of emojis')

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

bundle
  .command('unlink [appId]')
  .description('Unlink a bundle in Capgo Cloud')
  .action(listBundle)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-b, --bundle <bundle>', 'bundle version number of the bundle to unlink')

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
  .command('decrypt [zipPath] [sessionKey]')
  .description('Decrypt a signed zip bundle')
  .action(decryptZip)
  .option('--key <key>', 'custom path for private signing key')
  .option('--key-data <keyData>', 'base64 private signing key')

bundle
  .command('encrypt [zipPath]')
  .description('Encrypt a zip bundle')
  .action(encryptZip)
  .option('--key <key>', 'custom path for private signing key')
  .option('--key-data <keyData>', 'base64 private signing key')

bundle
  .command('zip [appId]')
  .description('Zip a bundle')
  .action(zipBundle)
  .option('-p, --path <path>', 'path of the folder to upload')
  .option('-b, --bundle <bundle>', 'bundle version number to name the zip file')
  .option('-n, --name <name>', 'name of the zip file')
  .option('-j, --json', 'output in JSON')
  .option('--no-code-check', 'Ignore checking if notifyAppReady() is called in soure code and index present in root folder')

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
  .option('--disable-auto-update <disableAutoUpdate>', 'Disable auto update strategy for this channel.The possible options are: major, minor, metadata, none')

const key = program
  .command('key')
  .description('Manage key')

key
  .command('save')
  .description('Save base64 signing key in capacitor config, useful for CI')
  .action(saveKeyCommand)
  .option('-f, --force', 'force generate a new one')
  .option('--key', 'key path to save in capacitor config')
  .option('--key-data <keyData>', 'key data to save in capacitor config')

key
  .command('create')
  .description('Create a new signing key')
  .action(createKeyCommand)
  .option('-f, --force', 'force generate a new one')

program
  .command('upload [appId]')
  .alias('u')
  .description('(Deprecated) Upload a new bundle to Capgo Cloud')
  .action(uploadDeprecatedCommand)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-p, --path <path>', 'path of the folder to upload')
  .option('-c, --channel <channel>', 'channel to link to')
  .option('-e, --external <url>', 'link to external url intead of upload to Capgo Cloud')
  .option('--key <key>', 'custom path for public signing key')
  .option('--key-data <keyData>', 'base64 public signing key')
  .option('--bundle-url', 'prints bundle url into stdout')
  .option('--no-key', 'ignore signing key and send clear update')
  .option('--display-iv-session', 'Show in the console the iv and session key used to encrypt the update')
  .option('-b, --bundle <bundle>', 'bundle version number of the file to upload')
  .option(
    '--min-update-version <minUpdateVersion>',
    'Minimal version required to update to this version. Used only if the disable auto update is set to metadata in channel',
  )

program.parseAsync()
