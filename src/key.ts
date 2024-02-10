import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { program } from 'commander'
import { writeConfig } from '@capacitor/cli/dist/config';
import * as p from '@clack/prompts';
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
  if (log) {
    p.intro(`Save keys 🔑`);
  }
  const config = await getConfig();
  const { extConfig } = config.app;

  const keyPath = options.key || baseKey
  // check if publicKey exist

  let privateKey = options.keyData || "";

  if (!existsSync(keyPath) && !privateKey) {
    if (log) {
      p.log.error(`Cannot find public key ${keyPath} or as keyData option or in ${config.app.extConfigFilePath}`);
      program.error('');
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
      extConfig.plugins = {
        extConfig: {},
        CapacitorUpdater: {}
      };
    }
    if (!extConfig.plugins.CapacitorUpdater) {
      extConfig.plugins.CapacitorUpdater = {};
    }
    extConfig.plugins.CapacitorUpdater.privateKey = privateKey;
    // console.log('extConfig', extConfig)
    writeConfig(extConfig, config.app.extConfigFilePath)
  }
  if (log) {
    p.log.success(`private key saved into ${config.app.extConfigFilePath} file in local directory`);
    p.log.success(`your app will decode the zip archive with this key`);
  }
  return true
}
export const saveKeyCommand = async (options: saveOptions) => {
  p.intro(`Save keys 🔑`);
  await checkLatest();
  await saveKey(options)
}

export const createKey = async (options: Options, log = true) => {
  // write in file .capgo the apikey in home directory
  if (log) {
    p.intro(`Create keys 🔑`);
  }
  const { publicKey, privateKey } = createRSA()

  // check if baseName already exist
  if (existsSync(baseKeyPub) && !options.force) {
    if (log) {
      p.log.error('Public Key already exists, use --force to overwrite');
      program.error('');
    } else {
      return false
    }
  }
  writeFileSync(baseKeyPub, publicKey);
  if (existsSync(baseKey) && !options.force) {
    if (log) {
      p.log.error('Private Key already exists, use --force to overwrite');
      program.error('');
    } else {
      return false
    }
  }
  writeFileSync(baseKey, privateKey);

  const config = await getConfig();
  const { extConfig } = config.app;
  if (extConfig) {
    if (!extConfig.plugins) {
      extConfig.plugins = {
        extConfig: {},
        CapacitorUpdater: {}
      };
    }
    extConfig.plugins.CapacitorUpdater.privateKey = privateKey;
    // console.log('extConfig', extConfig)
    writeConfig(extConfig, config.app.extConfigFilePath)
  }

  if (log) {
    p.log.success('Your RSA key has been generated')
    p.log.success(`Public key saved in ${baseKeyPub}`)
    p.log.success('This key will be use to encrypt your bundle before sending it to Capgo')
    p.log.success('Keep it safe')
    p.log.success('Than make it unreadable by Capgo and unmodifiable by anyone')
    p.log.success(`Private key saved in ${config.app.extConfigFilePath}`);
    p.log.success('Your app will be the only one having it');
    p.log.success('Only your users can decrypt your update');
    p.log.success('Only you can send them an update');
    p.outro(`Done ✅`);
  }
  return true
}

export const createKeyCommand = async (options: Options) => {
  await checkLatest();
  await createKey(options)
}
