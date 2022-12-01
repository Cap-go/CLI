import { program } from 'commander'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { encryptSource } from '../api/crypto';
import { baseKeyPub } from './utils';

export const encryptZip = async (zipPath: string) => {
  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    program.error(`Zip not found at the path ${zipPath}`);
  }

  if (!existsSync(baseKeyPub)) {
    program.error(`Public Key not found at the path ${baseKeyPub}`);
  }
  // open with fs publicKey path
  const keyFile = readFileSync(baseKeyPub)
  const keyString = keyFile.toString()

  const zipFile = readFileSync(zipPath)
  const encodedZip = encryptSource(zipFile, keyString)
  console.log('ivSessionKey', encodedZip.ivSessionKey)
  // write decodedZip in a file
  writeFileSync(`${zipPath}_encrypted.zip`, encodedZip.encryptedData)
}
