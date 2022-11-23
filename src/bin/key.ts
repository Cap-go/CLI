import { program } from 'commander'
import { existsSync, writeFileSync } from 'fs'
import NodeRSA from 'node-rsa'
import { writeConfig } from '@capacitor/cli/dist/config';
import { baseKey, baseKeyPub, getConfig } from './utils';

interface Options {
  force: boolean;
}

export const createKey = async (options: Options) => {
  // write in file .capgo the apikey in home directory

  if (!existsSync('.git')) {
    program.error('To use local you should be in a git repository');
  }
  const key = new NodeRSA({ b: 512 });
  const pair = key.generateKeyPair();
  const publicKey = pair.exportKey('public');
  const privateKey = pair.exportKey('private');

  // convert privateKey to base64
  const privateKeyBase64 = Buffer.from(privateKey).toString('base64');

  // check if baseName already exist
  if (existsSync(baseKey) && !options.force) {
    program.error(`Private Key already exists, use --force to overwrite`);
  }
  writeFileSync(baseKey, privateKey);
  if (existsSync(baseKeyPub) && !options.force) {
    program.error(`Public Key already exists, use --force to overwrite`);
  }
  writeFileSync(baseKeyPub, publicKey);

  const config = await getConfig();
  const { extConfig } = config.app;
  if (extConfig) {
    if (!extConfig.plugins) {
      extConfig.plugins = {};
    }
    if (!extConfig.plugins.CapacitorUpdater) {
      extConfig.plugins.CapacitorUpdater = {};
    }
    extConfig.plugins.CapacitorUpdater.privateKey = privateKeyBase64;
    // console.log('extConfig', extConfig)
    writeConfig(extConfig, config.app.extConfigFilePath)
  }

  console.log(`public key saved into ${baseKeyPub} file in local directory\n`);
  console.log(`This key will be use to sign your zip archive sent to Capgo,
than make them unreadable by Capgo and not modifiable by anyone\n`);
  console.log(`private key saved into ${baseKey} file in local directory\n`);
  console.log(`It's recommended to don't git ${baseKeyPub} and ${baseKey} files\n`);
  console.log(`private key saved into ${config.app.extConfigFilePath} file in local directory`);
  console.log(`your app will decode the zip archive with this key\n`);
}
