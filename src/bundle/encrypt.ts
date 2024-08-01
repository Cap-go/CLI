import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { exit } from 'node:process'
import { program } from 'commander'
import ciDetect from 'ci-info'
import { confirm as confirmC, intro, log, outro } from '@clack/prompts'
import { checkLatest } from '../api/update'
import { encryptSource } from '../api/crypto'
import { baseKeyPub, getLocalConfig } from '../utils'

interface Options {
  key?: string
  keyData?: string
}

export async function encryptZip(zipPath: string, options: Options) {
  intro(`Encryption`)

  await checkLatest()
  const localConfig = await getLocalConfig()

  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    log.error(`Error: Zip not found at the path ${zipPath}`)
    program.error('')
  }

  const keyPath = options.key || baseKeyPub
  // check if publicKey exist

  let publicKey = options.keyData || ''

  if (!existsSync(keyPath) && !publicKey) {
    log.warning(`Cannot find public key ${keyPath} or as keyData option`)
    if (ciDetect.isCI) {
      log.error(`Error: Missing public key`)
      program.error('')
    }
    const res = await confirmC({ message: 'Do you want to use our public key ?' })
    if (!res) {
      log.error(`Error: Missing public key`)
      program.error('')
    }
    publicKey = localConfig.signKey || ''
  }
  else if (existsSync(keyPath)) {
    // open with fs publicKey path
    const keyFile = readFileSync(keyPath)
    publicKey = keyFile.toString()
  }

  const zipFile = readFileSync(zipPath)
  const encodedZip = encryptSource(zipFile, publicKey)
  log.success(`ivSessionKey: ${encodedZip.ivSessionKey}`)
  // write decodedZip in a file
  writeFileSync(`${zipPath}_encrypted.zip`, encodedZip.encryptedData)
  log.success(`Encrypted zip saved at ${zipPath}_encrypted.zip`)
  outro(`Done ✅`)
  exit()
}
