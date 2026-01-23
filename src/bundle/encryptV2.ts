import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { intro, log, outro } from '@clack/prompts'
import { encryptChecksumV2, encryptSourceV2, generateSessionKey } from '../api/cryptoV2'
import { checkAlerts } from '../api/update'
import { baseKeyV2, formatError, getConfig } from '../utils'

interface Options {
  key?: string
  keyData?: string
  json?: boolean
}

export interface EncryptResult {
  checksum: string
  filename: string
  ivSessionKey: string
}

function emitJsonError(error: unknown) {
  console.error(formatError(error))
}

export async function encryptZipV2Internal(
  zipPath: string,
  checksum: string,
  options: Options,
  silent = false,
): Promise<EncryptResult> {
  const { json } = options
  const shouldShowPrompts = !json && !silent

  if (shouldShowPrompts) {
    intro('Encryption')
    await checkAlerts()
  }

  try {
    const extConfig = await getConfig()

    const hasPrivateKeyInConfig = !!extConfig.config.plugins?.CapacitorUpdater?.privateKey
    const hasPublicKeyInConfig = !!extConfig.config.plugins?.CapacitorUpdater?.publicKey

    if (hasPrivateKeyInConfig && shouldShowPrompts)
      log.warning('There is still a privateKey in the config')

    if (!existsSync(zipPath)) {
      const message = `Zip not found at the path ${zipPath}`
      if (!silent) {
        if (json)
          emitJsonError({ error: 'zip_not_found' })
        else
          log.error(`Error: ${message}`)
      }
      throw new Error(message)
    }

    if (!hasPublicKeyInConfig) {
      if (!silent) {
        if (json)
          emitJsonError({ error: 'missing_public_key' })
        else
          log.warning('Warning: Missing Public Key in config')
      }
      throw new Error('Missing public key in config')
    }

    const keyPath = options.key || baseKeyV2
    let privateKey = options.keyData || ''

    if (!existsSync(keyPath) && !privateKey) {
      if (!silent) {
        if (json) {
          emitJsonError({ error: 'missing_key' })
        }
        else {
          log.warning(`Cannot find a private key at ${keyPath} or as a keyData option`)
          log.error('Error: Missing key')
        }
      }
      throw new Error('Missing private key')
    }
    else if (existsSync(keyPath)) {
      privateKey = readFileSync(keyPath, 'utf8')
    }

    if (privateKey && !privateKey.startsWith('-----BEGIN RSA PRIVATE KEY-----')) {
      if (!silent) {
        if (json)
          emitJsonError({ error: 'invalid_private_key' })
        else
          log.error('The private key provided is not a valid RSA Private key')
      }
      throw new Error('Invalid private key format')
    }

    const zipFile = readFileSync(zipPath)
    const { sessionKey, ivSessionKey } = generateSessionKey(privateKey)
    const encryptedData = encryptSourceV2(zipFile, sessionKey, ivSessionKey)
    const encodedChecksum = encryptChecksumV3(checksum, privateKey)
    const filenameEncrypted = `${zipPath}_encrypted.zip`

    writeFileSync(filenameEncrypted, encryptedData)

    if (!silent) {
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({
          checksum: encodedChecksum,
          filename: filenameEncrypted,
          ivSessionKey,
        }, null, 2))
      }
      else {
        log.success(`Encoded Checksum: ${encodedChecksum}`)
        log.success(`ivSessionKey: ${ivSessionKey}`)
        log.success(`Encrypted zip saved at ${filenameEncrypted}`)
        outro('Done ✅')
      }
    }

    return {
      checksum: encodedChecksum,
      filename: filenameEncrypted,
      ivSessionKey,
    }
  }
  catch (error) {
    if (!silent) {
      if (options.json)
        emitJsonError(error)
      else
        log.error(`Error encrypting zip file ${formatError(error)}`)
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export async function encryptZipV2(zipPath: string, checksum: string, options: Options) {
  await encryptZipV2Internal(zipPath, checksum, options, false)
}
