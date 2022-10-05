import { program } from 'commander';
import { addApp } from './add';
import { deleteApp } from './delete';
import { setChannel } from './set';
import { uploadVersion } from './upload';
import pack from '../../package.json'
import { login } from './login';
import { listApp } from './list';

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
  .option('-c, --channel <channel>', 'channel to link to')
  .option('-b, --bundle <bundle>', 'bundle version number of the file to upload')
  .option('-s, --state <state>', 'set the state of the channel, public or private')
  .option('-a, --apikey <apikey>', 'apikey to link to your account');

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

program.parse(process.argv);