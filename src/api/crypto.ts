import {
  constants,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  sign,
} from 'node:crypto'
import { Buffer } from 'node:buffer'

const algorithm = 'aes-128-cbc'
const oaepHash = 'sha256'
const formatB64 = 'base64'
const padding = constants.RSA_PKCS1_OAEP_PADDING

export function signBundle(bundle: Buffer, key: string): string {
  return sign('sha512', bundle, {
    key,
    padding: constants.RSA_PKCS1_PADDING,
  }).toString(formatB64)
}

export function decryptSource(source: Buffer, ivSessionKey: string, privateKey: string): Buffer {
  // console.log('\nivSessionKey', ivSessionKey)
  const [ivB64, sessionb64Encrypted] = ivSessionKey.split(':')
  // console.log('\nsessionb64Encrypted', sessionb64Encrypted)
  // console.log('\nivB64', ivB64)
  const sessionKey = privateDecrypt(
    {
      key: privateKey,
      padding,
      oaepHash,
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
export function encryptSource(source: Buffer, publicKey: string): Encoded {
  // encrypt zip with key
  const initVector = randomBytes(16)
  const sessionKey = randomBytes(16)
  // encrypt session key with public key
  // console.log('\nencrypted.key', encrypted.key.toString(CryptoJS.enc.Base64))
  const cipher = createCipheriv(algorithm, sessionKey, initVector)
  cipher.setAutoPadding(true)
  // console.log('\nsessionKey', sessionKey.toString())
  // const sessionB64 = sessionKey.toString(formatB64)
  // console.log('\nsessionB64', sessionB64)
  const ivB64 = initVector.toString(formatB64)
  // console.log('\nivB64', ivB64)
  const sessionb64Encrypted = publicEncrypt(
    {
      key: publicKey,
      padding,
      oaepHash,
    },
    sessionKey,
  ).toString(formatB64)
  // console.log('\nsessionb64Encrypted', sessionb64Encrypted)
  const ivSessionKey = `${ivB64}:${sessionb64Encrypted}`
  // console.log('\nivSessionKey', sessionKey)
  // encrypted to buffer

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
  else if (format === 'der/pem') {
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
