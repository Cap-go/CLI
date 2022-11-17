import { program } from 'commander';
import { addApp } from './add';
import { deleteApp } from './delete';
import { setChannel } from './set';
import { uploadVersion } from './upload';
import pack from '../../package.json'
import { login } from './login';
import { listApp } from './list';
import { cleanupApp } from './cleanup';

program
  .version(pack.version)
  .command('add [appid]').alias('a')
  .action(addApp)
  .option('-n, --name <name>', 'app name')
  .option('-i, --icon <icon>', 'app icon path')
  .option('-a, --apikey <apikey>', 'apikey to link to your account');

program
  .version(pack.version)
  .command('login [apikey]').alias('l')
  .action(login)
  .option('--local', 'Only save in local folder');


program
  .command('upload [appid]').alias('u')
  .action(uploadVersion)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-p, --path <path>', 'path of the file to upload')
  .option('-c, --channel <channel>', 'channel to link to')
  .option('-e, --external <url>', 'link to external url intead of upload to capgo cloud')
  .option('-f, --format <base64|hex|binary|utf8>', 'choose the upload format default base64')
  .option('-b, --bundle <bundle>', 'bundle version number of the file to upload');

program
  .command('set [appid]').alias('s')
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
  .description('Manage package and version in capgo Cloud')
  .command('delete [appid]').alias('d')
  .action(deleteApp)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-b, --bundle <bundle>', 'bundle version number of the app to delete');

program
  .description('List versions in capgo Cloud')
  .command('list [appid]').alias('ls')
  .action(listApp)
  .option('-a, --apikey <apikey>', 'apikey to link to your account');

program
  .description('Cleanup versions in capgo Cloud')
  .command('cleanup [appid]').alias('c')
  .action(cleanupApp)
  .requiredOption('-b, --bundle <bundle>', 'bundle version number of the app to delete')
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-k, --keep <keep>', 'number of version to keep')
  .option('-f, --force', 'force removal');

program.parse(process.argv);