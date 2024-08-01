import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { exit } from 'node:process'
import { program } from 'commander'
import { intro, log, outro } from '@clack/prompts'
import { decryptSource } from '../api/crypto'
import { baseKey, getConfig } from '../utils'
import { checkLatest } from '../api/update'

interface Options {
  key?: string
  keyData?: string
}

export async function decryptZip(zipPath: string, ivsessionKey: string, options: Options) {
  intro(`Decrypt zip file`)
  await checkLatest()
  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    log.error(`Zip not found at the path ${zipPath}`)
    program.error('')
  }

  const config = await getConfig()
  const { extConfig } = config.app

  if (!options.key && !existsSync(baseKey) && !extConfig.plugins?.CapacitorUpdater?.privateKey) {
    log.error(`Private Key not found at the path ${baseKey} or in ${config.apextConfigFilePath}`)
    program.error('')
  }
  const keyPath = options.key || baseKey
  // check if publicKey exist

  let privateKey = extConfig?.plugins?.CapacitorUpdater?.privateKey

  if (!existsSync(keyPath) && !privateKey) {
    log.error(`Cannot find public key ${keyPath} or as keyData option or in ${config.apextConfigFilePath}`)
    program.error('')
  }
  else if (existsSync(keyPath)) {
    // open with fs publicKey path
    const keyFile = readFileSync(keyPath)
    privateKey = keyFile.toString()
  }
  // console.log('privateKey', privateKey)

  const zipFile = readFileSync(zipPath)

  const decodedZip = decryptSource(zipFile, ivsessionKey, options.keyData ?? privateKey ?? '')
  // write decodedZip in a file
  writeFileSync(`${zipPath}_decrypted.zip`, decodedZip)
  outro(`Decrypted zip file at ${zipPath}_decrypted.zip`)
  exit()
}
