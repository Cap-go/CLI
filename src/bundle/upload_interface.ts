import type { OptionsBase } from '../utils'

export interface OptionsUpload extends OptionsBase {
  bundle?: string
  path?: string
  channel?: string
  displayIvSession?: boolean
  external?: string
  key?: boolean
  keyV2?: string
  keyDataV2?: string
  ivSessionKey?: string
  s3Region?: string
  s3Apikey?: string
  s3Apisecret?: string
  s3BucketName?: string
  s3Port?: number
  s3SSL?: boolean
  s3Endpoint?: string
  bundleUrl?: boolean
  codeCheck?: boolean
  oldEncryption?: boolean
  minUpdateVersion?: string
  autoMinUpdateVersion?: boolean
  autoSetBundle?: boolean
  ignoreMetadataCheck?: boolean
  ignoreChecksumCheck?: boolean
  timeout?: number
  multipart?: boolean
  partial?: boolean
  partialOnly?: boolean
  tus?: boolean
  encryptedChecksum?: string
  packageJson?: string
  dryUpload?: boolean
  nodeModules?: string
  encryptPartial?: boolean
  deleteLinkedBundleOnUpload?: boolean
  tusChunkSize?: number
}
