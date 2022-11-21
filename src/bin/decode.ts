import { program } from 'commander'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import NodeRSA from 'node-rsa'
import { baseKey } from './utils';

interface Options {
  key?: boolean | string
}

export const decodeZip = async (zipPath: string, options: Options) => {
  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    program.error(`Zip not found at the path ${zipPath}`);
  }

  if (!options.key && !existsSync(baseKey)) {
    program.error(`Public Key not found at the path ${baseKey}`);
  }
  const publicKey = typeof options.key === 'string' ? options.key : baseKey
  // check if publicKey exist
  if (!existsSync(publicKey)) {
    program.error(`Cannot find public key ${publicKey}`)
  }
  // open with fs publicKey path
  const keyFile = readFileSync(publicKey)
  const zipFile = readFileSync(zipPath)
  const nodeRsa = new NodeRSA(keyFile.toString())
  const decodedZip = nodeRsa.decrypt(zipFile)
  // write decodedZip in a file
  writeFileSync(`${zipPath}decoded.zip`, decodedZip)
}
