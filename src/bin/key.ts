import { program } from 'commander'
import { existsSync, writeFileSync } from 'fs'
import NodeRSA from 'node-rsa'
import { writeConfig } from '@capacitor/cli/dist/config';
import { baseKeyPub, getConfig } from './utils';

interface Options {
  force?: boolean;
  private?: string;
  public?: string;
}

// const saveKey = async (privateKeyBase64: string) => {
//   if (!existsSync('.git')) {
//     program.error('To use local you should be in a git repository');
//   }

//   const config = await getConfig();
//   const { extConfig } = config.app;
//   if (extConfig) {
//     if (!extConfig.plugins) {
//       extConfig.plugins = {};
//     }
//     if (!extConfig.plugins.CapacitorUpdater) {
//       extConfig.plugins.CapacitorUpdater = {};
//     }
//     extConfig.plugins.CapacitorUpdater.privateKey = privateKeyBase64;
//     // console.log('extConfig', extConfig)
//     writeConfig(extConfig, config.app.extConfigFilePath)
//   }

//   console.log(`private key saved into ${config.app.extConfigFilePath} file in local directory`);
//   console.log(`your app will decode the zip archive with this key\n`);

// }

const createKey = async (options: Options) => {
  // write in file .capgo the apikey in home directory

  if (!existsSync('.git')) {
    program.error('To use local you should be in a git repository');
  }
  const key = new NodeRSA({ b: 512 });
  const pair = key.generateKeyPair();
  const publicKey = pair.exportKey('pkcs8-public-pem');
  const privateKey = pair.exportKey('pkcs8-private-pem');

  // remove header and footer of privateKey
  const privateKeyClean = privateKey.replace('-----BEGIN PRIVATE KEY-----\n', '').replace('\n-----END PRIVATE KEY-----', '')

  // check if baseName already exist
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
    extConfig.plugins.CapacitorUpdater.privateKey = privateKeyClean;
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

  // if (option === 'save') {
  //   if (!options.private) {
  //     program.error('You should provide a private key to save');
  //   }
  //   saveKey(options.private);
  // } else 
  if (option === 'create') {
    createKey(options);
  } else {
    program.error('You should provide a valid option (create or save)');
  }
}