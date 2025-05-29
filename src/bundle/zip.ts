import type {
  OptionsBase,
} from '../utils'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd, exit } from 'node:process'
import { intro, log, outro, spinner } from '@clack/prompts'
import { checksum as getChecksum } from '@tomasklaen/checksum'
import { program } from 'commander'
import coerceVersion from 'semver/functions/coerce'
import semverGte from 'semver/functions/gte'
import { checkAlerts } from '../api/update'
import {
  baseKeyV2,
  findRoot,
  formatError,
  getAllPackagesDependencies,
  getAppId,
  getBundleVersion,
  getConfig,
  PACKNAME,
  regexSemver,
  zipFile,
} from '../utils'
import { checkIndexPosition, searchInDirectory } from './check'

const alertMb = 20

interface Options extends OptionsBase {
  bundle?: string
  path?: string
  codeCheck?: boolean
  name?: string
  json?: boolean
  keyV2?: boolean
  packageJson?: string
}

export async function zipBundle(appId: string, options: Options) {
  try {
    let { bundle, path } = options
    const { json } = options
    if (!json)
      await checkAlerts()

    const extConfig = await getConfig()
    appId = getAppId(appId, extConfig?.config)
    // create bundle name format : 1.0.0-beta.x where x is a uuid
    const uuid = randomUUID().split('-')[0]
    const packVersion = getBundleVersion('', options.packageJson)
    bundle = bundle || packVersion || `0.0.1-beta.${uuid}`
    if (!json)
      intro(`Zipping ${appId}@${bundle}`)
    // check if bundle is valid
    if (bundle && !regexSemver.test(bundle)) {
      if (!json)
        log.error(`Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`)
      else
        console.error(formatError({ error: 'invalid_semver' }))
      program.error('')
    }
    path = path || extConfig?.config?.webDir
    if (!appId || !bundle || !path) {
      if (!json)
        log.error('Missing argument, you need to provide a appId and a bundle and a path, or be in a capacitor project')
      else
        console.error(formatError({ error: 'missing_argument' }))
      program.error('')
    }
    if (!json)
      log.info(`Started from path "${path}"`)
    const checkNotifyAppReady = options.codeCheck
    if (typeof checkNotifyAppReady === 'undefined' || checkNotifyAppReady) {
      const isPluginConfigured = searchInDirectory(path, 'notifyAppReady')
      if (!isPluginConfigured) {
        if (!json)
          log.error(`notifyAppReady() is missing in the build folder of your app. see: https://capgo.app/docs/plugin/api/#notifyappready`)
        else
          console.error(formatError({ error: 'notifyAppReady_not_in_source_code' }))
        program.error('')
      }
      const foundIndex = checkIndexPosition(path)
      if (!foundIndex) {
        if (!json)
          log.error(`index.html is missing in the root folder of ${path}`)
        else
          console.error(formatError({ error: 'index_html_not_found' }))
        program.error('')
      }
    }
    const zipped = await zipFile(path)
    if (!json)
      log.info(`Zipped ${zipped.byteLength} bytes`)
    const s = spinner()
    if (!json)
      s.start(`Calculating checksum`)
    let checksum = ''
    const root = join(findRoot(cwd()), PACKNAME)
    const dependencies = await getAllPackagesDependencies(undefined, options.packageJson || root)
    const updaterVersion = dependencies.get('@capgo/capacitor-updater')
    let isv7 = false
    const coerced = coerceVersion(updaterVersion)
    if (!updaterVersion) {
      // TODO: remove this once we have a proper way to check the version
      log.warn('Cannot find @capgo/capacitor-updater in ./package.json, provide the package.json path with --package-json it\'s required for v7 CLI to work')
      program.error('')
      return undefined as any
    }
    else if (coerced) {
      isv7 = semverGte(coerced.version, '7.0.0')
    }
    else if (updaterVersion === 'link:@capgo/capacitor-updater') {
      log.warn('Using local @capgo/capacitor-updater. Assuming v7')
      isv7 = true
    }
    if (options.keyV2 || existsSync(baseKeyV2) || isv7) {
      checksum = await getChecksum(zipped, 'sha256')
    }
    else {
      checksum = await getChecksum(zipped, 'crc32')
    }
    if (!json)
      s.stop(`Checksum: ${checksum}`)
    const mbSize = Math.floor(zipped.byteLength / 1024 / 1024)
    // We do not issue this warning for json
    if (mbSize > alertMb && !json) {
      log.warn(`WARNING !!\nThe bundle size is ${mbSize} Mb, this may take a while to download for users\n`)
      log.warn(`Learn how to optimize your assets https://capgo.app/blog/optimise-your-images-for-updates/\n`)
    }
    const s2 = spinner()
    const name = options.name || `${appId}_${bundle}.zip`
    if (!json)
      s2.start(`Saving to ${name}`)
    writeFileSync(name, zipped)
    if (!json)
      s2.stop(`Saved to ${name}`)

    if (!json)
      outro(`Done ✅`)

    if (json) {
      const output = {
        bundle,
        filename: name,
        checksum,
      }
      // Keep the console log and stringify for user who parse the output
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(output, null, 2))
    }
    exit()
  }
  catch (error) {
    log.error(formatError(error))
    program.error('')
  }
}
