import { Buffer } from 'node:buffer'
import {
  constants,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  privateEncrypt,
  publicDecrypt,
  randomBytes,
} from 'node:crypto'

const algorithm = 'aes-128-cbc'
const formatB64 = 'base64'
const padding = constants.RSA_PKCS1_PADDING

export function generateSessionKey(key: string): { sessionKey: Buffer, ivSessionKey: string } {
  const initVector = randomBytes(16)
  const sessionKey = randomBytes(16)
  const ivB64 = initVector.toString(formatB64)
  const sessionb64Encrypted = privateEncrypt(
    {
      key,
      padding,
    },
    sessionKey,
  ).toString(formatB64)

  return {
    sessionKey,
    ivSessionKey: `${ivB64}:${sessionb64Encrypted}`,
  }
}

export function encryptSourceV2(source: Buffer, sessionKey: Buffer, ivSessionKey: string): Buffer {
  const [ivB64] = ivSessionKey.split(':')
  const initVector = Buffer.from(ivB64, formatB64)
  const cipher = createCipheriv(algorithm, sessionKey, initVector)
  cipher.setAutoPadding(true)
  const encryptedData = Buffer.concat([cipher.update(source), cipher.final()])
  return encryptedData
}

export function decryptSourceV2(source: Buffer, ivSessionKey: string, key: string): Buffer {
  const [ivB64, sessionb64Encrypted] = ivSessionKey.split(':')
  const sessionKey: Buffer = publicDecrypt(
    {
      key,
      padding,
    },
    Buffer.from(sessionb64Encrypted, formatB64),
  )

  // ivB64 to uft-8
  const initVector = Buffer.from(ivB64, formatB64)
  // console.log('\nSessionB64', sessionB64)

  const decipher = createDecipheriv(algorithm, sessionKey, initVector)
  decipher.setAutoPadding(true)
  const decryptedData = Buffer.concat([decipher.update(source), decipher.final()])

  return decryptedData
}

export function encryptChecksumV2(checksum: string, key: string): string {
  const checksumEncrypted = privateEncrypt(
    {
      key,
      padding,
    },
    Buffer.from(checksum, formatB64),
  ).toString(formatB64)

  return checksumEncrypted
}
export function createRSA(format: 'pem' | 'der/pem' = 'pem', keySize = 2048): RSAKeys {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    // The standard secure default length for RSA keys is 2048 bits
    modulusLength: keySize,
  })

  // Generate RSA key pair
  if (format === 'pem') {
    return {
      publicKey: publicKey.export({
        type: 'pkcs1',
        format: 'pem',
      }) as string,
      privateKey: privateKey.export({
        type: 'pkcs1',
        format: 'pem',
      }) as string,
    }
  }
  else {
    return {
      publicKey: publicKey.export({
        type: 'spki',
        format: 'der',
      }).toString('base64'),
      privateKey: privateKey.export({
        type: 'pkcs1',
        format: 'pem',
      }).toString('base64'),
    }
  }
}

export function decryptChecksumV2(checksum: string, key: string): string {
  const checksumDecrypted = publicDecrypt(
    {
      key,
      padding,
    },
    Buffer.from(checksum, formatB64),
  ).toString(formatB64)

  return checksumDecrypted
}

export interface RSAKeys {
  publicKey: string
  privateKey: string
}
export function createRSAV2(): RSAKeys {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })

  // Generate RSA key pair
  return {
    publicKey: publicKey.export({
      type: 'pkcs1',
      format: 'pem',
    }) as string,
    privateKey: privateKey.export({
      type: 'pkcs1',
      format: 'pem',
    }) as string,
  }
}
