/* eslint-disable no-console */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { program } from 'commander'
import { confirm, intro, isCancel, log, outro } from '@clack/prompts'
import { writeConfig } from './config'
import { createRSA, signBundle } from './api/crypto'
import { baseSignKey, baseSignKeyPub, formatError, getConfig } from './utils'
import { checkLatest } from './api/update'

interface saveOptions {
  key?: string
  keyData?: string
}
interface signFileOptions {
  json?: boolean
  stdout?: boolean
}
interface Options {
  force?: boolean
}

export async function saveSignKey(options: saveOptions, logg = true) {
  if (logg)
    intro(`Save keys 🔑`)

  return true
}
export async function saveSignKeyCommand(_options: saveOptions) {
  intro(`Save keys 🔑`)
  await checkLatest()
}

export async function signFileCommand(file: string, options: signFileOptions) {
  const { json, stdout } = options

  if (!json) {
    await checkLatest()
    intro(`Sign a bundle 🔏`)
  }

  const extConfig = await getConfig()

  if (!extConfig?.config?.plugins?.CapacitorUpdater.signKey || !existsSync(baseSignKey) || !existsSync(baseSignKeyPub)) {
    if (json) {
      console.log(JSON.stringify({ error: 'Signing not configured properly' }))
    }
    else {
      log.error('Signing not configured properly')
    }
  }

  if (!existsSync(file)) {
    if (json) {
      console.log(JSON.stringify({ error: 'File does not exist' }))
    }
    else {
      log.error('File does not exist')
    }
  }

  try {
    const data = readFileSync(file)
    const privateKey = readFileSync(baseSignKey, 'utf-8')
    const signature = signBundle(data, privateKey)

    if (stdout) {
      log.success('Generated signature:')
      log.success(signature)
    }
    else if (json) {
      console.log(JSON.stringify({ signature }))
    }
    else {
      const path = `${file}.capgo_sign`
      writeFileSync(path, signature)

      log.success(`Saved signature to: ${path}`)
    }

    process.exit(0)
  }
  catch (error) {
    if (json) {
      console.log(JSON.stringify({ error: 'Error while generating signature. Run without --json to get more output' }))
      process.exit(1)
    }
    else {
      log.error(`Error while generating signature ${formatError(error)}`)
      program.error('')
    }
  }
}

export async function createSignKey(options: Options, logg = true) {
  // write in file .capgo the apikey in home directory
  if (logg)
    intro(`Create keys 🔑`)

  const extConfig = await getConfig()
  if (
    (extConfig?.config?.plugins?.CapacitorUpdater.signKey
    || existsSync(baseSignKey)
    || existsSync(baseSignKeyPub)) && !options.force) {
    log.error('Private or public signing key already exists, use --force to overwrite')

    if (logg) {
      program.error('')
    }
    else {
      return false
    }
  }

  const { publicKey, privateKey } = createRSA('der/pem')
  log.success('Your RSA key has been generated, saving')

  writeFileSync(baseSignKeyPub, publicKey)
  writeFileSync(baseSignKey, privateKey)

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

    const flattenPublicKey = publicKey.replace(/\\n/g, '\\n')
    extConfig.config.plugins.CapacitorUpdater.signKey = flattenPublicKey
    writeConfig(extConfig)

    if (logg) {
      log.success('Your RSA signing key has been generated')
      log.success(`Public key saved in ${baseSignKeyPub}`)
      log.success('This key will be useed to verify your bundle\'s signature')
      log.success(`It has been also saved in ${extConfig.path}`)
      log.success(`Private key saved in ${baseSignKey}`)
      log.success('KEEP IT SAFE AT ALL COST')
      log.success('It will be used to sign bundles before uploading them to capgo')

      if (existsSync('.gitignore')) {
        const addToIgnore = await confirm({ message: 'Git ignore found, would you like to add the private key into it?' })
        if (isCancel(addToIgnore) || !addToIgnore) {
          log.info('Ok, not adding to git ignore')
        }
        else {
          let gitIgnore = readFileSync('.gitignore', 'utf-8')
          gitIgnore = `${gitIgnore}\n${baseSignKey}`
          writeFileSync('.gitignore', gitIgnore)
          log.success('Added the private signing key to .gitignore')
        }
      }

      outro(`Done ✅`)
    }
  }
  else {
    log.error('Cannot find capacitor config (?)')
    if (logg) {
      program.error('')
    }
    else {
      return false
    }
  }

  return true
}

export async function createSignKeyCommand(options: Options) {
  await checkLatest()
  await createSignKey(options)
}
