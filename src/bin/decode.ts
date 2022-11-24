import { program } from 'commander'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import NodeRSA from 'node-rsa'
import aes from 'crypto-js/aes';
import { baseKey, getConfig } from './utils';

interface Options {
  key?: boolean | string
}

export const decodeZip = async (zipPath: string, sessionKey: string, options: Options) => {
  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    program.error(`Zip not found at the path ${zipPath}`);
  }

  const config = await getConfig();
  const { extConfig } = config.app;

  if (!options.key && !existsSync(baseKey) && !extConfig.plugins.CapacitorUpdater.privateKey) {
    program.error(`Private Key not found at the path ${baseKey} or in ${config.app.extConfigFilePath}`);
  }
  const privateKey = typeof options.key === 'string' ? options.key : baseKey
  // check if publicKey exist

  let keyString = extConfig.plugins.CapacitorUpdater.privateKey;

  if (!existsSync(privateKey) && !extConfig.plugins.CapacitorUpdater.privateKey) {
    program.error(`Cannot find public key ${privateKey}`)
  } else if (existsSync(privateKey)) {
    // open with fs publicKey path
    const keyFile = readFileSync(privateKey)
    keyString = keyFile.toString()
  }

  const zipFile = readFileSync(zipPath)
  const nodeRsa = new NodeRSA(keyString, 'pkcs8-private-pem');
  if (nodeRsa.isPublic()) {
    program.error(`Cannot use public key to decode, please use private key`)
  }
  const decodedSessionKey = nodeRsa.decrypt(sessionKey, 'base64')
  console.log('Session Key', decodedSessionKey)
  const decodedZip = aes.decrypt(zipFile.toString(), decodedSessionKey).toString()

  // write decodedZip in a file
  writeFileSync(`${zipPath}decoded.zip`, decodedZip)
}
