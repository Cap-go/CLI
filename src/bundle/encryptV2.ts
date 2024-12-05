import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { encryptChecksumV2, encryptSourceV2 } from '../api/cryptoV2'
import { checkAlerts } from '../api/update'
import { baseKeyV2, formatError, getConfig } from '../utils'

interface Options {
  key?: string
  keyData?: string
  json?: boolean
}

export async function encryptZipV2(zipPath: string, checksum: string, options: Options) {
  const { json } = options

  if (!json) {
    intro(`Encryption`)
    await checkAlerts()
  }

  const extConfig = await getConfig()

  const hasPrivateKeyInConfig = !!extConfig.config.plugins?.CapacitorUpdater?.privateKey
  const hasPublicKeyInConfig = !!extConfig.config.plugins?.CapacitorUpdater?.publicKey

  if (hasPrivateKeyInConfig && !json)
    log.warning(`There is still a privateKey in the config`)

  // write in file .capgo the apikey in home directory

  if (!existsSync(zipPath)) {
    if (!json)
      log.error(`Error: Zip not found at the path ${zipPath}`)
    else
      console.error(formatError({ error: 'zip_not_found' }))
    program.error('')
  }

  if (!hasPublicKeyInConfig) {
    if (!json)
      log.warning(`Warning: Missing Public Key in config`)
    else
      console.error(formatError({ error: 'missing_public_key' }))
    program.error('')
  }

  const keyPath = options.key || baseKeyV2
  // check if publicKey exist

  // let publicKey = options.keyData || ''
  let privateKey = options.keyData || ''

  if (!existsSync(keyPath) && !privateKey) {
    if (!json) {
      log.warning(`Cannot find a private key at ${keyPath} or as a keyData option`)
      log.error(`Error: Missing key`)
    }
    else {
      console.error(formatError({ error: 'missing_key' }))
    }
    program.error('')
  }
  else if (existsSync(keyPath)) {
    // open with fs key path
    const keyFile = readFileSync(keyPath)
    privateKey = keyFile.toString()
  }

  // let's doublecheck and make sure the key we are using is the right type based on the decryption strategy
  if (privateKey && !privateKey.startsWith('-----BEGIN RSA PRIVATE KEY-----')) {
    if (!json) {
      log.error(`the private key provided is not a valid RSA Private key`)
    }
    else {
      console.error(formatError({ error: 'invalid_private_key' }))
    }
    program.error('')
  }

  const zipFile = readFileSync(zipPath)
  const encodedZip = encryptSourceV2(zipFile, privateKey)
  const encodedChecksum = encryptChecksumV2(checksum, privateKey)

  const filename_encrypted = `${zipPath}_encrypted.zip`
  if (json) {
    // Keep the console log and stringify for user who parse the output
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      checksum: encodedChecksum,
      filename: filename_encrypted,
      ivSessionKey: encodedZip.ivSessionKey,
    }, null, 2))
  }
  else {
    log.success(`Encoded Checksum: ${encodedChecksum}`)
    log.success(`ivSessionKey: ${encodedZip.ivSessionKey}`)
  }

  // write decodedZip in a file
  writeFileSync(filename_encrypted, encodedZip.encryptedData)
  if (!json) {
    log.success(`Encrypted zip saved at ${filename_encrypted}`)
    outro(`Done ✅`)
  }
  exit()
}
