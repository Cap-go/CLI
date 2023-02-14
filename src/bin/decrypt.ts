import { program } from 'commander'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { decryptSource } from '../api/crypto';
import { baseKey, getConfig } from './utils';
import { checkLatest } from '../api/update';

interface Options {
  key?: string
  keyData?: string
}

export const decryptZip = async (zipPath: string, ivsessionKey: string, options: Options) => {
  await checkLatest();
  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    program.error(`Zip not found at the path ${zipPath}`);
  }

  const config = await getConfig();
  const { extConfig } = config.app;

  if (!options.key && !existsSync(baseKey) && !extConfig.plugins?.CapacitorUpdater?.privateKey) {
    program.error(`Private Key not found at the path ${baseKey} or in ${config.app.extConfigFilePath}`);
  }
  const keyPath = options.key || baseKey
  // check if publicKey exist

  let { privateKey } = options.keyData || extConfig?.plugins?.CapacitorUpdater || "";

  if (!existsSync(keyPath) && !privateKey) {
    program.error(`Cannot find public key ${keyPath} or as keyData option or in ${config.app.extConfigFilePath}`)
  } else if (existsSync(keyPath)) {
    // open with fs publicKey path
    const keyFile = readFileSync(keyPath)
    privateKey = keyFile.toString()
  }
  // console.log('privateKey', privateKey)

  const zipFile = readFileSync(zipPath)
  const decodedZip = decryptSource(zipFile, ivsessionKey, privateKey)
  // write decodedZip in a file
  writeFileSync(`${zipPath}_decrypted.zip`, decodedZip)
  process.exit()
}
