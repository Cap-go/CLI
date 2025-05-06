import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { checksum as getChecksum } from '@tomasklaen/checksum'
import { program } from 'commander'
import { decryptChecksumV2, decryptSourceV2 } from '../api/cryptoV2'
import { checkAlerts } from '../api/update'
import { baseKeyPubV2, formatError, getConfig } from '../utils'

interface Options {
  key?: string
  keyData?: string
  checksum?: string
}

export async function decryptZipV2(zipPath: string, ivsessionKey: string, options: Options) {
  intro(`Decrypt zip file`)
  try {
    await checkAlerts()
    // write in file .capgo the apikey in home directory

    if (!existsSync(zipPath)) {
      log.error(`Zip not found at the path ${zipPath}`)
      program.error('')
    }

    const extConfig = await getConfig()

    if (!options.key && !existsSync(baseKeyPubV2) && !extConfig.config.plugins?.CapacitorUpdater?.privateKey) {
      log.error(`Private Key not found at the path ${baseKeyPubV2} or in ${extConfig.path}`)
      program.error('')
    }
    const keyPath = options.key || baseKeyPubV2
    // check if publicKey exist

    let publicKey = extConfig.config.plugins?.CapacitorUpdater?.publicKey

    if (!existsSync(keyPath) && !publicKey) {
      log.error(`Cannot find public key ${keyPath} or as keyData option or in ${extConfig.path}`)
      program.error('')
    }
    else if (existsSync(keyPath)) {
    // open with fs publicKey path
      const keyFile = readFileSync(keyPath)
      publicKey = keyFile.toString()
    }
    // console.log('privateKey', privateKey)

    const zipFile = readFileSync(zipPath)

    const decodedZip = decryptSourceV2(zipFile, ivsessionKey, options.keyData ?? publicKey ?? '')
    // write decodedZip in a file
    writeFileSync(`${zipPath}_decrypted.zip`, decodedZip)
    log.info(`Decrypted zip file at ${zipPath}_decrypted.zip`)
    if (options.checksum) {
      const checksum = await getChecksum(decodedZip, 'sha256')
      const decryptedChecksum = decryptChecksumV2(options.checksum, options.keyData ?? publicKey ?? '')
      if (checksum !== decryptedChecksum) {
        log.error(`Checksum does not match ${checksum} !== ${decryptedChecksum}`)
        program.error('')
      }
      else {
        log.info(`Checksum matches`)
      }
    }
    outro('✅ done')
    exit()
  }
  catch (err) {
    log.error(`Error decrypting zip file ${formatError(err)}`)
    program.error('')
  }
}
