import { program } from 'commander';
import { decryptZip } from './decrypt';
import { encryptZip } from './encrypt';
import { addApp } from './add';
import { getInfo } from './info';
import { manageKey } from './key';
import { manageChannel } from './channel';
import { deleteApp } from './delete';
import { setChannel } from './set';
import { uploadVersion } from './upload';
import pack from '../../package.json'
import { login } from './login';
import { listApp } from './list';
import { cleanupApp } from './cleanup';

program
  .description('Manage packages and bundle versions in capgo Cloud')
  .version(pack.version);

program
  .command('add [appid]')
  .alias('a')
  .description('Add a new app to capgo Cloud')
  .action(addApp)
  .option('-n, --name <name>', 'app name')
  .option('-i, --icon <icon>', 'app icon path')
  .option('-a, --apikey <apikey>', 'apikey to link to your account');

program
  .command('info')
  .alias('i')
  .description('Get info about your Capgo install')
  .action(getInfo);

program
  .command('login [apikey]')
  .alias('l')
  .description('Save apikey to your machine or folder')
  .action(login)
  .option('--local', 'Only save in local folder');

program
  .command('upload [appid]')
  .alias('u')
  .description('Upload a new bundle to capgo Cloud')
  .action(uploadVersion)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-p, --path <path>', 'path of the folder to upload')
  .option('-c, --channel <channel>', 'channel to link to')
  .option('-e, --external <url>', 'link to external url intead of upload to capgo cloud')
  .option('--key <key>', 'custom path for public signing key')
  .option('--keyData <keyData>', 'base64 public signing key')
  .option('--no-key', 'ignore signing key and send clear update')
  .option('--display-iv-session', 'Show in the console the iv and session key used to encrypt the update')
  .option('-b, --bundle <bundle>', 'bundle version number of the file to upload');

program
  .command('set [appid]')
  .alias('s')
  .description('Modify a channel configuration')
  .action(setChannel)
  .requiredOption('-c, --channel <channel>', 'channel to link to')
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-b, --bundle <bundle>', 'bundle version number of the file to set')
  .option('-s, --state <state>', 'set the state of the channel, default or normal')
  .option('--downgrade', 'Allow to downgrade to version under native one')
  .option('--latest', 'get the latest version key in the package.json to set it to the channel')
  .option('--no-downgrade', 'Disable downgrade to version under native one')
  .option('--upgrade', 'Allow to upgrade to version above native one')
  .option('--no-upgrade', 'Disable upgrade to version above native one')
  .option('--ios', 'Allow sending update to ios devices')
  .option('--no-ios', 'Disable sending update to ios devices')
  .option('--android', 'Allow sending update to android devices')
  .option('--no-android', 'Disable sending update to android devices')
  .option('--self-assign', 'Allow to device to self assign to this channel')
  .option('--no-self-assign', 'Disable devices to self assign to this channel');

program
  .command('delete [appid]')
  .alias('d')
  .description('Delete an app from capgo Cloud')
  .action(deleteApp)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-b, --bundle <bundle>', 'bundle version number of the app to delete');

program
  .command('list [appid]')
  .alias('ls')
  .description('List versions in capgo Cloud')
  .action(listApp)
  .option('-a, --apikey <apikey>', 'apikey to link to your account');

program
  .command('cleanup [appid]')
  .alias('c')
  .description('Cleanup versions in capgo Cloud')
  .action(cleanupApp)
  .option('-b, --bundle <bundle>', 'bundle version number of the app to delete')
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-k, --keep <keep>', 'number of version to keep')
  .option('-f, --force', 'force removal');

program
  .command('channel [mode] [channelid] [appid]')
  .description('Create, set or delete channel')
  .action(manageChannel)
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
  .option('--no-self-assign', 'Disable devices to self assign to this channel');

program
  .command('key [option]')
  .description('Save base64 signing key in capacitor config, usefull for CI')
  .action(manageKey)
  .option('-f, --force', 'force generate a new one');


program
  .command('decrypt [zipPath] [sessionKey]')
  .description('Decrypt a signed zip update')
  .action(decryptZip)
  .option('--key <key>', 'custom path for private signing key')
  .option('--keyData <keyData>', 'base64 private signing key');

program
  .command('encrypt [zipPath]')
  .description('Encrypt a zip update')
  .action(encryptZip)
  .option('--key <key>', 'custom path for private signing key')
  .option('--keyData <keyData>', 'base64 private signing key');

program.parseAsync();