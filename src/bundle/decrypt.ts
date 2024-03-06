import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { program } from 'commander'
import * as p from '@clack/prompts'
import { decryptSource } from '../api/crypto'
import { baseKeyPub, getConfig } from '../utils'
import { checkLatest } from '../api/update'

interface Options {
  key?: string
  keyData?: string
}

export async function decryptZip(zipPath: string, ivsessionKey: string, options: Options) {
  p.intro(`Decrypt zip file`)
  await checkLatest()
  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    p.log.error(`Zip not found at the path ${zipPath}`)
    program.error('')
  }

  const config = await getConfig()
  const { extConfig } = config.app
  // console.log('config - ', config)
  // console.log('extConfig - ', extConfig)

  const hasPrivateKeyInConfig = extConfig?.plugins?.CapacitorUpdater?.privateKey ? true : false
  // console.log(`There ${hasPrivateKeyInConfig ? 'IS' : 'IS NOT'} a privateKey in the config`);

  if (hasPrivateKeyInConfig)
    p.log.warning(`There is still a privateKey in the config`)

  if (!options.key && !existsSync(baseKeyPub) && !extConfig.plugins?.CapacitorUpdater?.publicKey) {
    p.log.error(`Public key not found at the path ${baseKeyPub} or in ${config.app.extConfigFilePath}`)
    program.error('')
  }
  const keyPath = options.key || baseKeyPub
  // check if private exist

  let publicKey = extConfig?.plugins?.CapacitorUpdater?.publicKey;

  if (!existsSync(keyPath) && !publicKey) {
    p.log.error(`Cannot find a public key at ${keyPath} or as keyData option or in ${config.app.extConfigFilePath}`)
    program.error('')
  }
  else if (existsSync(keyPath)) {
    // open with fs publicKey path
    const keyFile = readFileSync(keyPath)
    publicKey = keyFile.toString()
  }

  // let's doublecheck and make sure the key we are using is the right type based on the decryption strategy
  if (publicKey && !publicKey.startsWith('-----BEGIN RSA PUBLIC KEY-----')) {
    p.log.error(`the public key provided is not a valid RSA Public key`)
    program.error('')
  }

  const zipFile = readFileSync(zipPath)

  const decodedZip = decryptSource(zipFile, ivsessionKey, options.keyData ?? publicKey ?? '')
  // write decodedZip in a file
  writeFileSync(`${zipPath}_decrypted.zip`, decodedZip)
  p.log.success(`Decrypted zip file at ${zipPath}_decrypted.zip`)
  p.outro(`Done ✅`)
  process.exit()
}
