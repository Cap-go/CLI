import { program } from 'commander'
import { existsSync, writeFileSync } from 'fs'
import EncryptRsa from 'encrypt-rsa'
import { baseKey, baseKeyPub } from './utils';

interface Options {
  force: boolean;
}

export const createKey = async (options: Options) => {
  // write in file .capgo the apikey in home directory

  if (!existsSync('.git')) {
    program.error('To use local you should be in a git repository');
  }
  const encryptRsa = new EncryptRsa();
  const { privateKey, publicKey } = encryptRsa.createPrivateAndPublicKeys();

  // check if baseName already exist
  if (existsSync(baseKey) && !options.force) {
    program.error(`Private Key already exists, use --force to overwrite`);
  }
  writeFileSync(baseKey, privateKey);
  if (existsSync(baseKeyPub) && !options.force) {
    program.error(`Public Key already exists, use --force to overwrite`);
  }
  writeFileSync(baseKeyPub, publicKey);

  console.log(`public key saved into ${baseKeyPub} file in local directory\n`);
  console.log(`This key will be use to sign your zip archive sent to Capgo,
than make them unreadable by Capgo and not modifiable by anyone\n`);
  console.log(`private key saved into ${baseKey} file in local directory,
You need to add it's content to capacitor.config under the key privateKey, like below:
{
	"appId": "**.***.**",
	"appName": "Name",
	"plugins": {
		"CapacitorUpdater": {
			"privateKey": "****",
		}
	}
}\n
Good practice is to not version this files in your git repository\n`);
}
