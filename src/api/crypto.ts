import aes from 'crypto-js/aes';
import NodeRSA from 'node-rsa'
import CryptoJS from 'crypto-js';
import { program } from 'commander';
import { randomUUID } from 'crypto';

export const decryptSource = (source: string, ivSessionKey: string, privateKey: string) => {
    const nodeRsa = new NodeRSA(privateKey, 'pkcs8-private-pem');
    if (!nodeRsa.isPrivate()) {
        program.error(`Cannot use public key to decode, please use private key`)
    }
    console.log('\nivSessionKey', ivSessionKey)
    const [ivB64, sessionb64Encrypted] = ivSessionKey.split(':');
    console.log('\nsessionb64Encrypted', sessionb64Encrypted)
    console.log('\nivB64', ivB64)
    const sessionDecrypted = nodeRsa.decrypt(sessionb64Encrypted, 'base64')
    console.log('\nsessionDecrypted', sessionDecrypted)
    const sessionB64 = CryptoJS.enc.Base64.parse(sessionDecrypted);
    console.log('\nsessionb64', CryptoJS.enc.Base64.stringify(sessionB64))
    // iv to worldaaray
    const iv = CryptoJS.enc.Base64.parse(ivB64);

    const decodedSource = aes.decrypt(source, sessionB64, { iv }).toString()

    return decodedSource
}
export interface Encoded {
    sessionKey: string,
    encodedSource: string
}
export const encryptSource = (source: string, publicKey: string): Encoded => {
    const nodeRsa = new NodeRSA(publicKey, 'pkcs8-public-pem')
    // check is key is private key
    if (nodeRsa.isPrivate()) {
        program.error(`Cannot use private key to encode, please use public key`)
    }
    // encrypt zip with key
    const encrypted = aes.encrypt(CryptoJS.enc.Base64.parse(source), randomUUID())
    // encrypt session key with public key
    const sessionB64 = CryptoJS.enc.Base64.stringify(encrypted.key)
    console.log('\nsessionb64', sessionB64)
    const ivB64 = CryptoJS.enc.Base64.stringify(encrypted.iv)
    console.log('\nivB64', ivB64)
    const sessionb64Encrypted = nodeRsa.encrypt(sessionB64, 'base64')
    console.log('\nsessionb64Encrypted', sessionb64Encrypted)
    const sessionKey = `${ivB64}:${sessionb64Encrypted}`
    console.log('\nivSessionKey', sessionKey)
    // encrypted to buffer
    const encodedSource = CryptoJS.enc.Base64.stringify(encrypted.ciphertext)
    return {
        encodedSource,
        sessionKey
    }
}
export interface RSAKeys {
    publicKey: string,
    privateKey: string
}
export const createRSA = (): RSAKeys => {
    const key = new NodeRSA({ b: 512 });
    const pair = key.generateKeyPair();
    const publicKey = pair.exportKey('pkcs8-public-pem');
    const privateKey = pair.exportKey('pkcs8-private-pem');
    return {
        publicKey,
        privateKey,
    }
}