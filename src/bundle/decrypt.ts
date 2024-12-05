import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { decryptSource } from '../api/crypto'
import { checkAlerts } from '../api/update'
import { baseKey, getConfig } from '../utils'

interface Options {
  key?: string
  keyData?: string
}

export async function decryptZip(zipPath: string, ivsessionKey: string, options: Options) {
  intro(`Decrypt zip file`)
  await checkAlerts()
  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    log.error(`Zip not found at the path ${zipPath}`)
    program.error('')
  }

  const extConfig = await getConfig()

  if (!options.key && !existsSync(baseKey) && !extConfig.config.plugins?.CapacitorUpdater?.privateKey) {
    log.error(`Private Key not found at the path ${baseKey} or in ${extConfig.path}`)
    program.error('')
  }
  const keyPath = options.key || baseKey
  // check if publicKey exist

  let privateKey = extConfig.config.plugins?.CapacitorUpdater?.privateKey

  if (!existsSync(keyPath) && !privateKey) {
    log.error(`Cannot find public key ${keyPath} or as keyData option or in ${extConfig.path}`)
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
