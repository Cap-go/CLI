import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { program } from 'commander'
import ciDetect from 'ci-info'
import * as p from '@clack/prompts'
import { checkLatest } from '../api/update'
import { encryptSource } from '../api/crypto'
import { baseKey, getLocalConfig, getConfig } from '../utils'

interface Options {
  key?: string
  keyData?: string
}

export async function encryptZip(zipPath: string, options: Options) {
  p.intro(`Encryption`)

  await checkLatest()
  const localConfig = await getLocalConfig()
  const config = await getConfig()
  const { extConfig } = config.app
  // console.log('localConfig - ', localConfig)
  // console.log('config - ', config)

  const hasPrivateKeyInConfig = extConfig?.plugins?.CapacitorUpdater?.privateKey ? true : false
  const hasPublicKeyInConfig = extConfig?.plugins?.CapacitorUpdater?.publicKey ? true : false

  if (hasPrivateKeyInConfig)
    p.log.warning(`There is still a privateKey in the config`)

  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    p.log.error(`Error: Zip not found at the path ${zipPath}`)
    program.error('')
  }

  if (!hasPublicKeyInConfig) {
    p.log.warning(`Warning: Missing Public Key in config`)
  }

  const keyPath = options.key || baseKey
  // check if publicKey exist

  //let publicKey = options.keyData || ''
  let privateKey = options.keyData || ''

  if (!existsSync(keyPath) && !privateKey) {
    p.log.warning(`Cannot find a private key at ${keyPath} or as a keyData option`)
    if (ciDetect.isCI) {
      p.log.error(`Error: Missing key`)
      program.error('')
    }
    const res = await p.confirm({ message: `Do you want to use our private key?` })
    if (!res) {
      p.log.error(`Error: Missing private key`)
      program.error('')
    }

    privateKey = localConfig.signKey || ''
  }
  else if (existsSync(keyPath)) {
    // open with fs key path
    const keyFile = readFileSync(keyPath)
    privateKey = keyFile.toString()
  }

  // let's doublecheck and make sure the key we are using is the right type based on the decryption strategy
  if (privateKey && !privateKey.startsWith('-----BEGIN RSA PRIVATE KEY-----')) {
      p.log.error(`the private key provided is not a valid RSA Private key`)
      program.error('')
  }

  const zipFile = readFileSync(zipPath)
  const encodedZip = encryptSource(zipFile, privateKey)
  p.log.success(`ivSessionKey: ${encodedZip.ivSessionKey}`)
  // write decodedZip in a file
  writeFileSync(`${zipPath}_encrypted.zip`, encodedZip.encryptedData)
  p.log.success(`Encrypted zip saved at ${zipPath}_encrypted.zip`)
  p.outro(`Done ✅`)
  process.exit()
}
