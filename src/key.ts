import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { program } from 'commander'
import { intro, log, outro } from '@clack/prompts'
import { writeConfig } from './config'
import { createRSA } from './api/crypto'
import { baseKey, baseKeyPub, getConfig } from './utils'
import { checkLatest } from './api/update'

interface saveOptions {
  key?: string
  keyData?: string
}
interface Options {
  force?: boolean
}

export async function saveKey(options: saveOptions, logg = true) {
  if (logg)
    intro(`Save keys 🔑`)

  const extConfig = await getConfig()

  const keyPath = options.key || baseKey
  // check if publicKey exist

  let privateKey = options.keyData || ''

  if (!existsSync(keyPath) && !privateKey) {
    if (logg) {
      log.error(`Cannot find public key ${keyPath} or as keyData option or in ${extConfig.path}`)
      program.error('')
    }
    else {
      return false
    }
  }
  else if (existsSync(keyPath)) {
    // open with fs publicKey path
    const keyFile = readFileSync(keyPath)
    privateKey = keyFile.toString()
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

    extConfig.config.plugins.CapacitorUpdater.privateKey = privateKey
    // console.log('extConfig', extConfig)
    await writeConfig(extConfig)
  }
  if (log) {
    log.success(`private key saved into ${extConfig.path} file in local directory`)
    log.success(`your app will decode the zip archive with this key`)
  }
  return true
}
export async function saveKeyCommand(options: saveOptions) {
  intro(`Save keys 🔑`)
  await checkLatest()
  await saveKey(options)
}

export async function createKey(options: Options, logg = true) {
  // write in file .capgo the apikey in home directory
  if (logg)
    intro(`Create keys 🔑`)

  const { publicKey, privateKey } = createRSA()

  // check if baseName already exist
  if (existsSync(baseKeyPub) && !options.force) {
    log.error('Public Key already exists, use --force to overwrite')
    if (logg) {
      program.error('')
    }
    else {
      return false
    }
  }
  writeFileSync(baseKeyPub, publicKey)
  if (existsSync(baseKey) && !options.force) {
    log.error('Private Key already exists, use --force to overwrite')
    if (logg) {
      program.error('')
    }
    else {
      return false
    }
  }
  writeFileSync(baseKey, privateKey)

  const extConfig = await getConfig()
  if (extConfig?.config) {
    if (!extConfig.config.plugins) {
      extConfig.config.plugins = {
        extConfig: {},
        CapacitorUpdater: {},
      }
    }

    if (!extConfig.config.plugins.CapacitorUpdater) {
      extConfig.config.plugins.CapacitorUpdater = {}
    }

    extConfig.config.plugins.CapacitorUpdater.privateKey = privateKey
    // console.log('extConfig', extConfig)
    writeConfig(extConfig)
  }

  if (logg) {
    log.success('Your RSA key has been generated')
    log.success(`Public key saved in ${baseKeyPub}`)
    log.success('This key will be use to encrypt your bundle before sending it to Capgo')
    log.success('Keep it safe')
    log.success('Than make it unreadable by Capgo and unmodifiable by anyone')
    log.success(`Private key saved in ${extConfig.path}`)
    log.success('Your app will be the only one having it')
    log.success('Only your users can decrypt your update')
    log.success('Only you can send them an update')
    outro(`Done ✅`)
  }
  return true
}

export async function createKeyCommand(options: Options) {
  await checkLatest()
  await createKey(options)
}
