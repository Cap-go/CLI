import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { intro, log, outro } from '@clack/prompts'
import { decryptChecksumV2, decryptSourceV2 } from '../api/cryptoV2'
import { checkAlerts } from '../api/update'
import { checksum as getChecksum } from '../checksum'
import { baseKeyPubV2, formatError, getConfig } from '../utils'

interface Options {
  key?: string
  keyData?: string
  checksum?: string
}

export interface DecryptResult {
  outputPath: string
  checksumMatches?: boolean
}

function resolvePublicKey(options: Options, extConfig: Awaited<ReturnType<typeof getConfig>>) {
  const fallbackKeyPath = options.key || baseKeyPubV2
  let publicKey = extConfig.config.plugins?.CapacitorUpdater?.publicKey

  if (existsSync(fallbackKeyPath)) {
    publicKey = readFileSync(fallbackKeyPath, 'utf8')
  }
  else if (!publicKey && options.keyData) {
    publicKey = options.keyData
  }

  return { publicKey, fallbackKeyPath }
}

export async function decryptZipV2Internal(
  zipPath: string,
  ivsessionKey: string,
  options: Options,
  silent = false,
): Promise<DecryptResult> {
  if (!silent)
    intro('Decrypt zip file')

  try {
    await checkAlerts()

    if (!existsSync(zipPath)) {
      const message = `Zip not found at the path ${zipPath}`
      if (!silent)
        log.error(message)
      throw new Error(message)
    }

    const extConfig = await getConfig()

    if (!options.key && !existsSync(baseKeyPubV2) && !extConfig.config.plugins?.CapacitorUpdater?.publicKey) {
      const message = `Public Key not found at the path ${baseKeyPubV2} or in ${extConfig.path}`
      if (!silent)
        log.error(message)
      throw new Error(message)
    }

    const { publicKey, fallbackKeyPath } = resolvePublicKey(options, extConfig)

    if (!publicKey) {
      const message = `Cannot find public key ${fallbackKeyPath} or as keyData option or in ${extConfig.path}`
      if (!silent)
        log.error(message)
      throw new Error(message)
    }

    const zipFile = readFileSync(zipPath)

    const decodedZip = decryptSourceV2(zipFile, ivsessionKey, options.keyData ?? publicKey)
    const outputPath = `${zipPath}_decrypted.zip`
    writeFileSync(outputPath, decodedZip)

    if (!silent)
      log.info(`Decrypted zip file at ${outputPath}`)

    let checksumMatches: boolean | undefined

    if (options.checksum) {
      const checksum = await getChecksum(decodedZip, 'sha256')
      const decryptedChecksum = decryptChecksumV2(options.checksum, options.keyData ?? publicKey)
      checksumMatches = checksum === decryptedChecksum

      if (!checksumMatches) {
        const message = `Checksum does not match ${checksum} !== ${decryptedChecksum}`
        if (!silent)
          log.error(message)
        throw new Error(message)
      }

      if (!silent)
        log.info('Checksum matches')
    }

    if (!silent)
      outro('✅ done')

    return { outputPath, checksumMatches }
  }
  catch (error) {
    if (!silent)
      log.error(`Error decrypting zip file ${formatError(error)}`)
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export async function decryptZipV2(zipPath: string, ivsessionKey: string, options: Options) {
  await decryptZipV2Internal(zipPath, ivsessionKey, options, false)
}
