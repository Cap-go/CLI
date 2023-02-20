import { checkLatest } from 'api/update';
import { program } from 'commander'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { encryptSource } from '../api/crypto';
import { baseKeyPub } from '../utils';

interface Options {
  key?: string
  keyData?: string
}

export const encryptZip = async (zipPath: string, options: Options) => {
  await checkLatest();
  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    program.error(`Zip not found at the path ${zipPath}`);
  }

  const keyPath = options.key || baseKeyPub
  // check if publicKey exist

  let publicKey = options.keyData || "";

  if (!existsSync(keyPath) && !publicKey) {
    program.error(`Cannot find public key ${keyPath} or as keyData option`)
  } else if (existsSync(keyPath)) {
    // open with fs publicKey path
    const keyFile = readFileSync(keyPath)
    publicKey = keyFile.toString()
  }

  const zipFile = readFileSync(zipPath)
  const encodedZip = encryptSource(zipFile, publicKey)
  console.log('ivSessionKey', encodedZip.ivSessionKey)
  // write decodedZip in a file
  writeFileSync(`${zipPath}_encrypted.zip`, encodedZip.encryptedData)
  console.log(`Done ✅`);
  process.exit()
}
