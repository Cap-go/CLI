import * as p from '@clack/prompts'
import { program } from 'commander'
import type { OptionsBase } from '../utils'
import { formatError } from '../utils'
import { uploadBundle as uploadBundleMono } from './upload-mono'
import { uploadBundle as uploadBundleoPartial } from './upload-partial'

export interface Options extends OptionsBase {
  bundle?: string
  path?: string
  channel?: string
  displayIvSession?: boolean
  external?: string
  key?: boolean | string
  keyData?: string
  ivSessionKey?: string
  bundleUrl?: boolean
  codeCheck?: boolean
  minUpdateVersion?: string
  autoMinUpdateVersion?: boolean
  ignoreMetadataCheck?: boolean
  partial?: boolean
}

export async function uploadCommand(apikey: string, options: Options) {
  try {
    if (options.partial !== undefined && options.partial)
      await uploadBundleoPartial(apikey, options, true)
    else
      await uploadBundleMono(apikey, options, true)
  }
  catch (error) {
    p.log.error(formatError(error))
    program.error('')
  }
}
