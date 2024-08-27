import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { program } from 'commander'
import { intro, log, outro } from '@clack/prompts'
import { writeConfig } from './config'
import { createRSA } from './api/crypto'
import { baseKey, baseKeyPub, baseKeyPubV2, baseKeyV2, getConfig } from './utils'
import { checkLatest } from './api/update'

interface saveOptions {
  key?: string
  keyData?: string
}
interface Options {
  force?: boolean
}

export async function saveKeyV2(options: saveOptions, logg = true) {
  if (logg)
    intro(`Save keys 🔑`)

  const extConfig = await getConfig()

  // const keyPath = options.key || baseKeyV2
  const keyPath = options.key || baseKeyPubV2
  // check if publicKey exist

  let publicKey = options.keyData || ''

  if (!existsSync(keyPath) && !publicKey) {
    if (log) {
      log.error(`Cannot find a public key at ${keyPath} or as keyData option or in ${extConfig.path}`)
      program.error('')
    }
    else {
      return false
    }
  }
  else if (existsSync(keyPath)) {
    // open with fs publicKey path
    const keyFile = readFileSync(keyPath)
    publicKey = keyFile.toString()
  }

  // let's doublecheck and make sure the key we are saving is the right type based on the decryption strategy
  if (publicKey) {
    if (!publicKey.startsWith('-----BEGIN RSA PUBLIC KEY-----')) {
      if (log) {
        log.error(`the public key provided is not a valid RSA Public key`)
        program.error('')
      }
      else {
        return false
      }
    }
  }

  if (extConfig?.config) {
    if (!extConfig.config.plugins) {
      extConfig.config.plugins = {
        extConfig: {},
        CapacitorUpdater: {},
      }
    }
    if (!extConfig.config.plugins.CapacitorUpdater)
      extConfig.config.plugins.CapacitorUpdater = {}
    // TODO: this might be a breaking change if user has other code looking at the specific value in the config file
    if (extConfig.config.plugins.CapacitorUpdater.privateKey) {
      delete extConfig.config.plugins.CapacitorUpdater.privateKey
      log.info('Old private key deleted from config file')
    }
    extConfig.config.plugins.CapacitorUpdater.publicKey = publicKey

    // console.log('extConfig', extConfig)
    await writeConfig(extConfig)
  }
  if (logg) {
    log.success(`public key saved into ${extConfig.path} file in local directory`)
    log.success(`your app will decode the zip archive with this key`)
  }
  return true
}

export async function deleteOldPrivateKey(options: Options, logg = true): Promise<boolean> {
  if (logg)
    intro(`Deleting old private key 🗑️`)

  const extConfig = await getConfig()

  if (extConfig?.config?.plugins?.CapacitorUpdater?.privateKey) {
    delete extConfig.config.plugins.CapacitorUpdater.privateKey
    await writeConfig(extConfig)
    // Delete the old private key file if it exists
    if (existsSync(baseKey)) {
      try {
        unlinkSync(baseKey)
        if (logg) {
          log.success(`Old private key file deleted: ${baseKey}`)
        }
      }
      catch {
        if (logg) {
          log.error(`Failed to delete old private key file: ${baseKey}`)
        }
      }
    }

    // Delete the old public key file if it exists
    if (existsSync(baseKeyPub)) {
      try {
        unlinkSync(baseKeyPub)
        if (logg) {
          log.success(`Old public key file deleted: ${baseKeyPub}`)
        }
      }
      catch {
        if (logg) {
          log.error(`Failed to delete old public key file: ${baseKeyPubV2}`)
        }
      }
    }

    if (logg) {
      log.success(`Old private key deleted from ${extConfig.path} file`)
    }
    return true
  }
  else {
    if (logg) {
      log.info(`No old private key found in config file`)
    }
    return false
  }
}

export async function saveKeyCommandV2(options: saveOptions) {
  intro(`Save keys 🔑`)
  await checkLatest()
  await saveKeyV2(options)
}

export async function createKeyV2(options: Options, logg = true) {
  // write in file .capgo the apikey in home directory
  if (logg)
    intro(`Create keys 🔑`)

  const { publicKey, privateKey } = createRSA()

  // check if baseName already exist
  if (existsSync(baseKeyPubV2) && !options.force) {
    log.error('Public Key already exists, use --force to overwrite')
    if (logg) {
      program.error('')
    }
    else {
      return false
    }
  }
  writeFileSync(baseKeyPubV2, publicKey)
  if (existsSync(baseKeyV2) && !options.force) {
    log.error('Private Key already exists, use --force to overwrite')
    if (logg) {
      program.error('')
    }
    else {
      return false
    }
  }
  writeFileSync(baseKeyV2, privateKey)

  const extConfig = await getConfig()

  if (extConfig) {
    if (!extConfig.config.plugins) {
      extConfig.config.plugins = {
        extConfig: {},
        CapacitorUpdater: {},
      }
    }

    if (!extConfig.config.plugins.CapacitorUpdater) {
      extConfig.config.plugins.CapacitorUpdater = {}
    }

    // TODO: this might be a breaking change if user has other code looking at the specific value in the config file
    if (extConfig.config.plugins.CapacitorUpdater.privateKey) {
      delete extConfig.config.plugins.CapacitorUpdater.privateKey
      log.info('Old private key deleted from config file')
    }

    // console.log('extConfig', extConfig)
    writeConfig(extConfig)
  }

  if (log) {
    log.success('Your RSA key has been generated')
    log.success(`Private key saved in ${baseKeyV2}`)
    log.success('This key will be use to encrypt your bundle before sending it to Capgo')
    log.success('Keep it safe')
    log.success('Than make it unreadable by Capgo and unmodifiable by anyone')
    log.success(`Public key saved in ${extConfig.path}`)
    log.success('Your app will be the only one having it')
    log.success('Only your users can decrypt your update')
    log.success('Only you can send them an update')
    outro(`Done ✅`)
  }
  return true
}

export async function createKeyCommandV2(options: Options) {
  await checkLatest()
  await createKeyV2(options)
}

export async function deleteOldKeyCommandV2(options: Options) {
  await checkLatest()
  await deleteOldPrivateKey(options)
}
