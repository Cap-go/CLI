import {
  constants,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  privateEncrypt,
  publicDecrypt,
  randomBytes,
} from 'node:crypto'
import { Buffer } from 'node:buffer'

const algorithm = 'aes-128-cbc'
const formatB64 = 'base64'
const padding = constants.RSA_PKCS1_PADDING

export function decryptSourceV2(source: Buffer, ivSessionKey: string, key: string): Buffer {
  // console.log('decryptKeyType - ', decryptKeyType);
  // console.log(key);
  // console.log('\nivSessionKey', ivSessionKey)
  const [ivB64, sessionb64Encrypted] = ivSessionKey.split(':')
  // console.log('\nsessionb64Encrypted', sessionb64Encrypted)
  // console.log('\nivB64', ivB64)
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
export interface Encoded {
  ivSessionKey: string
  encryptedData: Buffer
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

export function encryptSourceV2(source: Buffer, key: string): Encoded {
  const initVector = randomBytes(16)
  const sessionKey = randomBytes(16)
  const cipher = createCipheriv(algorithm, sessionKey, initVector)
  cipher.setAutoPadding(true)
  const ivB64 = initVector.toString(formatB64)
  const sessionb64Encrypted = privateEncrypt(
    {
      key,
      padding,
    },
    sessionKey,
  ).toString(formatB64)

  const ivSessionKey = `${ivB64}:${sessionb64Encrypted}`
  const encryptedData = Buffer.concat([cipher.update(source), cipher.final()])

  return {
    encryptedData,
    ivSessionKey,
  }
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
//  test AES

// const source = 'Hello world'
// console.log('\nsource', source)
// const { publicKey, privateKey } = createRSA()

// console.log('\nencryptSource ================================================================')
// //  convert source to base64
// const sourceBuff = Buffer.from(source)
// const res = encryptSource(sourceBuff, publicKey)
// console.log('\nencryptedData', res.encryptedData.toString('base64'))
// // console.log('\nres', res)
// console.log('\ndecryptSource ================================================================')
// const decodedSource = decryptSource(res.encryptedData, res.ivSessionKey, privateKey)
// // convert decodedSource from base64 to utf-8
// const decodedSourceString = decodedSource.toString('utf-8')
// console.log('\ndecodedSourceString', decodedSourceString)
// console.log('\n Is match', decodedSourceString === source)