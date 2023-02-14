import { program } from 'commander'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { writeConfig } from '@capacitor/cli/dist/config';
import { createRSA } from '../api/crypto';
import { baseKey, baseKeyPub, getConfig } from './utils';
import { checkLatest } from '../api/update';

interface Options {
  force?: boolean;
  key?: string
  keyData?: string
}

const saveKey = async (privateKeyPath: string | undefined, privateKeyData: string | undefined) => {
  if (!existsSync('.git')) {
    program.error('To use local you should be in a git repository');
  }

  const config = await getConfig();
  const { extConfig } = config.app;

  const keyPath = privateKeyPath || baseKey
  // check if publicKey exist

  let privateKey = privateKeyData || "";

  if (!existsSync(keyPath) && !privateKey) {
    program.error(`Cannot find public key ${keyPath} or as keyData option or in ${config.app.extConfigFilePath}`)
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

  console.log(`private key saved into ${config.app.extConfigFilePath} file in local directory`);
  console.log(`your app will decode the zip archive with this key\n`);

}

const createKey = async (options: Options) => {
  // write in file .capgo the apikey in home directory

  if (!existsSync('.git')) {
    program.error('To use local you should be in a git repository');
  }
  const { publicKey, privateKey } = createRSA()

  // check if baseName already exist
  if (existsSync(baseKeyPub) && !options.force) {
    program.error(`Public Key already exists, use --force to overwrite`);
  }
  writeFileSync(baseKeyPub, publicKey);
  if (existsSync(baseKey) && !options.force) {
    program.error(`Private Key already exists, use --force to overwrite`);
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

  console.log(`Your RSA key has been generated using node-rsa with this settings:\n
- encryptionScheme — 'pkcs1_oaep'.
- signingScheme — 'pkcs8-sha256'.
- bits — 2048.
- exp — 65537.\n`);
  console.log(`public key saved into ${baseKeyPub} file in local directory\n`);
  console.log(`This key will be use to encode your zipped bundle before sending it to Capgo,
than make them unreadable by Capgo and unmodifiable by anyone\n`);
  console.log(`Private key saved into ${config.app.extConfigFilePath} file in local directory`);
  console.log(`Your app will decode with this key the zipped bundle\n`);
}

export const manageKey = async (option: string, options: Options) => {
  await checkLatest();
  if (option === 'save') {
    saveKey(options.key, options.keyData);
  } else
    if (option === 'create') {
      createKey(options);
    } else {
      program.error('You should provide a valid option (create or save)');
    }
  process.exit()
}