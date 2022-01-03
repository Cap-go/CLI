import program from 'commander';
import { addApp } from './add';
import { deleteApp } from './delete';
import { setVersion } from './set';
import { uploadVersion } from './upload';

program
  .description('add one packages')
  .command('add [appid]').alias('a')
  .action(addApp)
  .option('-n, --name <name>', 'app name')
  .option('-i, --icon <icon>', 'app icon path')
  .option('-a, --apikey <apikey>', 'apikey to link to your account');

program
  .description('upload one package')
  .command('upload [appid]').alias('u')
  .action(uploadVersion)
  .option('-a, --apikey <apikey>', 'apikey to link to your account')
  .option('-p, --path <path>', 'path of the file to upload')
  .option('-v, --version <version>', 'version number of the file to upload');

program
  .description('set one version to channel')
  .command('set [appid] [version] [channel]').alias('s')
  .action(setVersion)
  .option('-a, --apikey <apikey>', 'apikey to link to your account');

program
  .description('delete one packages')
  .command('delete [appid]').alias('a')
  .action(deleteApp)
  .option('-a, --apikey <apikey>', 'apikey to link to your account');

program.parse(process.argv);