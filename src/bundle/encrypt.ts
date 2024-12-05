import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { encryptSource } from '../api/crypto'
import { checkAlerts } from '../api/update'
import { baseKeyPub } from '../utils'

interface Options {
  key?: string
  keyData?: string
}

export async function encryptZip(zipPath: string, options: Options) {
  intro(`Encryption`)

  await checkAlerts()

  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    log.error(`Error: Zip not found at the path ${zipPath}`)
    program.error('')
  }

  const keyPath = options.key || baseKeyPub
  // check if publicKey exist

  let publicEncryptionKey = options.keyData || ''

  if (existsSync(keyPath)) {
    // open with fs publicKey path
    const keyFile = readFileSync(keyPath)
    publicEncryptionKey = keyFile.toString()
  }

  const zipFile = readFileSync(zipPath)
  const encodedZip = encryptSource(zipFile, publicEncryptionKey)
  log.success(`ivSessionKey: ${encodedZip.ivSessionKey}`)
  // write decodedZip in a file
  writeFileSync(`${zipPath}_encrypted.zip`, encodedZip.encryptedData)
  log.success(`Encrypted zip saved at ${zipPath}_encrypted.zip`)
  outro(`Done ✅`)
  exit()
}
