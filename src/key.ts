import { program } from 'commander'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { writeConfig } from '@capacitor/cli/dist/config';
import { createRSA } from './api/crypto';
import { baseKey, baseKeyPub, getConfig } from './utils';
import { checkLatest } from './api/update';

interface saveOptions {
  key?: string
  keyData?: string
}
interface Options {
  force?: boolean;
}

export const saveKey = async (options: saveOptions, log = true) => {
  if (!existsSync('.git')) {
    program.error('To use local you should be in a git repository');
  }

  const config = await getConfig();
  const { extConfig } = config.app;

  const keyPath = options.key || baseKey
  // check if publicKey exist

  let privateKey = options.keyData || "";

  if (!existsSync(keyPath) && !privateKey) {
    if (log) {
      program.error(`Cannot find public key ${keyPath} or as keyData option or in ${config.app.extConfigFilePath}`)
    } else {
      return false
    }
  } else if (existsSync(keyPath)) {
    // open with fs publicKey path
    const keyFile = readFileSync(keyPath)
    privateKey = keyFile.toString()
  }

  if (extConfig) {
    if (!extConfig.plugins) {
      extConfig.plugins = {};
    }
    if (!extConfig.plugins.CapacitorUpdater) {
      extConfig.plugins.CapacitorUpdater = {};
    }
    extConfig.plugins.CapacitorUpdater.privateKey = privateKey;
    // console.log('extConfig', extConfig)
    writeConfig(extConfig, config.app.extConfigFilePath)
  }
  if (log) {
    console.log(`private key saved into ${config.app.extConfigFilePath} file in local directory`);
    console.log(`your app will decode the zip archive with this key\n`);
  }
  return true
}
export const saveKeyCommand = async (options: saveOptions) => {
  await checkLatest();
  await saveKey(options)
}

export const createKey = async (options: Options, log = true) => {
  // write in file .capgo the apikey in home directory

  if (!existsSync('.git')) {
    program.error('To use local you should be in a git repository');
  }
  const { publicKey, privateKey } = createRSA()

  // check if baseName already exist
  if (existsSync(baseKeyPub) && !options.force) {
    if (log) {
      program.error(`Public Key already exists, use --force to overwrite`);
    } else {
      return false
    }
  }
  writeFileSync(baseKeyPub, publicKey);
  if (existsSync(baseKey) && !options.force) {
    if (log) {
      program.error(`Private Key already exists, use --force to overwrite`);
    } else {
      return false
    }
  }
  writeFileSync(baseKey, privateKey);

  const config = await getConfig();
  const { extConfig } = config.app;
  if (extConfig) {
    if (!extConfig.plugins) {
      extConfig.plugins = {};
    }
    if (!extConfig.plugins.CapacitorUpdater) {
      extConfig.plugins.CapacitorUpdater = {};
    }
    extConfig.plugins.CapacitorUpdater.privateKey = privateKey;
    // console.log('extConfig', extConfig)
    writeConfig(extConfig, config.app.extConfigFilePath)
  }

  if (log) {
    console.log(`Your RSA key has been generated\n`);
    console.log(`public key saved into ${baseKeyPub} file in local directory\n`);
    console.log(`This key will be use to encode AES key used to crypt your zipped bundle before sending it to Capgo,
  than make them unreadable by Capgo and unmodifiable by anyone\n`);
    console.log(`Private key saved into ${config.app.extConfigFilePath} file in local directory`);
    console.log(`Your app will decode with this RSA key the AES key and use it to decode the zipped bundle\n`);
  }
  return true
}

export const createKeyCommand = async (options: Options) => {
  await checkLatest();
  await createKey(options)
}
