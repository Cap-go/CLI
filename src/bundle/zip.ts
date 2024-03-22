import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import AdmZip from 'adm-zip'
import { program } from 'commander'
import * as p from '@clack/prompts'
import { checksum as getChecksum } from '@tomasklaen/checksum'
import { checkLatest } from '../api/update'
import type {
  OptionsBase,
} from '../utils'
import {
  formatError,
  getConfig,
  regexSemver,
  useLogSnag,
} from '../utils'
import { checkIndexPosition, searchInDirectory } from './check'

const alertMb = 20

interface Options extends OptionsBase {
  bundle?: string
  path?: string
  codeCheck?: boolean
  name?: string
  json?: boolean
}

export async function zipBundle(appId: string, options: Options) {
  let { bundle, path } = options
  const { json } = options
  const snag = useLogSnag()
  if (!json)
    await checkLatest()

  const config = await getConfig()
  appId = appId || config?.app?.appId
  // create bundle name format : 1.0.0-beta.x where x is a uuid
  const uuid = randomUUID().split('-')[0]
  bundle = bundle || config?.app?.package?.version || `0.0.1-beta.${uuid}`
  if (!json)
    p.intro(`Zipping ${appId}@${bundle}`)
    // check if bundle is valid
  if (!regexSemver.test(bundle)) {
    if (!json)
      p.log.error(`Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`)
    else
      console.error(formatError({ error: 'invalid_semver' }))
    program.error('')
  }
  path = path || config?.app?.webDir
  if (!appId || !bundle || !path) {
    if (!json)
      p.log.error('Missing argument, you need to provide a appId and a bundle and a path, or be in a capacitor project')
    else
      console.error(formatError({ error: 'missing_argument' }))
    program.error('')
  }
  if (!json)
    p.log.info(`Started from path "${path}"`)
  const checkNotifyAppReady = options.codeCheck
  if (typeof checkNotifyAppReady === 'undefined' || checkNotifyAppReady) {
    const isPluginConfigured = searchInDirectory(path, 'notifyAppReady')
    if (!isPluginConfigured) {
      if (!json)
        p.log.error(`notifyAppReady() is missing in the source code. see: https://capgo.app/docs/plugin/api/#notifyappready`)
      else
        console.error(formatError({ error: 'notifyAppReady_not_in_source_code' }))
      program.error('')
    }
    const foundIndex = checkIndexPosition(path)
    if (!foundIndex) {
      if (!json)
        p.log.error(`index.html is missing in the root folder or in the only folder in the root folder`)
      else
        console.error(formatError({ error: 'index_html_not_found' }))
      program.error('')
    }
  }
  const zip = new AdmZip()
  zip.addLocalFolder(path)
  const zipped = zip.toBuffer()
  if (!json)
    p.log.info(`Zipped ${zipped.byteLength} bytes`)
  const s = p.spinner()
  if (!json)
    s.start(`Calculating checksum`)
  const checksum = await getChecksum(zipped, 'crc32')
  if (!json)
    s.stop(`Checksum: ${checksum}`)
  const mbSize = Math.floor(zipped.byteLength / 1024 / 1024)
  // We do not issue this warning for json
  if (mbSize > alertMb && !json) {
    p.log.warn(`WARNING !!\nThe app size is ${mbSize} Mb, this may take a while to download for users\n`)
    p.log.warn(`Learn how to optimize your assets https://capgo.app/blog/optimise-your-images-for-updates/\n`)
    await snag.track({
      channel: 'app-error',
      event: 'App Too Large',
      icon: '🚛',
      tags: {
        'app-id': appId,
      },
      notify: false,
    }).catch()
  }
  const s2 = p.spinner()
  const name = options.name || `${appId}_${bundle}.zip`
  if (!json)
    s2.start(`Saving to ${name}`)
  writeFileSync(name, zipped)
  if (!json)
    s2.stop(`Saved to ${name}`)

  await snag.track({
    channel: 'app',
    event: 'App zip',
    icon: '⏫',
    tags: {
      'app-id': appId,
    },
    notify: false,
  }).catch()

  if (!json)
    p.outro(`Done ✅`)

  if (json) {
    const output = {
      bundle,
      filename: name,
      checksum,
    }
    // Keep the console log and stringify
    console.log(JSON.stringify(output, null, 2))
  }
  process.exit()
}
