import type { OptionsBase } from '../utils'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { intro, log, outro, spinner } from '@clack/prompts'
import { checksum as getChecksum } from '@tomasklaen/checksum'
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

export interface ZipResult {
  bundle: string
  filename: string
  checksum: string
}

function emitJson(value: unknown) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(value, null, 2))
}

function emitJsonError(error: unknown) {
  // eslint-disable-next-line no-console
  console.error(formatError(error))
}

export async function zipBundleInternal(appId: string, options: Options, silent = false): Promise<ZipResult> {
  const { json } = options
  let { bundle, path } = options

  const shouldShowPrompts = !json && !silent

  try {
    if (shouldShowPrompts)
      await checkAlerts()

    const extConfig = await getConfig()
    const resolvedAppId = getAppId(appId, extConfig?.config)

    const uuid = randomUUID().split('-')[0]
    const packVersion = getBundleVersion('', options.packageJson)
    bundle = bundle || packVersion || `0.0.1-beta.${uuid}`

    if (shouldShowPrompts)
      intro(`Zipping ${resolvedAppId}@${bundle}`)

    if (bundle && !regexSemver.test(bundle)) {
      const message = `Your bundle name ${bundle}, is not valid it should follow semver convention : https://semver.org/`
      if (!silent) {
        if (json)
          emitJsonError({ error: 'invalid_semver' })
        else
          log.error(message)
      }
      throw new Error('Invalid bundle version format')
    }

    path = path || extConfig?.config?.webDir

    if (!resolvedAppId || !bundle || !path) {
      const message = 'Missing argument, you need to provide a appId and a bundle and a path, or be in a capacitor project'
      if (!silent) {
        if (json)
          emitJsonError({ error: 'missing_argument' })
        else
          log.error(message)
      }
      throw new Error(message)
    }

    if (shouldShowPrompts)
      log.info(`Started from path "${path}"`)

    const shouldCheckNotifyAppReady = typeof options.codeCheck === 'undefined' ? true : options.codeCheck

    if (shouldCheckNotifyAppReady) {
      const isPluginConfigured = searchInDirectory(path, 'notifyAppReady')
      if (!isPluginConfigured) {
        if (!silent) {
          if (json)
            emitJsonError({ error: 'notifyAppReady_not_in_source_code' })
          else
            log.error('notifyAppReady() is missing in the build folder of your app. see: https://capgo.app/docs/plugin/api/#notifyappready')
        }
        throw new Error('notifyAppReady() is missing in build folder')
      }

      const foundIndex = checkIndexPosition(path)
      if (!foundIndex) {
        if (!silent) {
          if (json)
            emitJsonError({ error: 'index_html_not_found' })
          else
            log.error(`index.html is missing in the root folder of ${path}`)
        }
        throw new Error('index.html is missing in root folder')
      }
    }

    const zipped = await zipFile(path)

    if (shouldShowPrompts)
      log.info(`Zipped ${zipped.byteLength} bytes`)

    const checksumSpinner = shouldShowPrompts ? spinner() : null
    if (checksumSpinner)
      checksumSpinner.start('Calculating checksum')

    const root = join(findRoot(cwd()), PACKNAME)
    const dependencies = await getAllPackagesDependencies(undefined, options.packageJson || root)
    const updaterVersion = dependencies.get('@capgo/capacitor-updater')

    if (!updaterVersion) {
      const warning = 'Cannot find @capgo/capacitor-updater in ./package.json, provide the package.json path with --package-json it\'s required for v7 CLI to work'
      if (!silent)
        log.warn(warning)
      throw new Error(warning)
    }

    let isV7 = false
    const coerced = coerceVersion(updaterVersion)

    if (coerced) {
      isV7 = semverGte(coerced.version, '7.0.0')
    }
    else if (updaterVersion === 'link:@capgo/capacitor-updater') {
      if (!silent)
        log.warn('Using local @capgo/capacitor-updater. Assuming v7')
      isV7 = true
    }

    const checksum = await getChecksum(
      zipped,
      options.keyV2 || existsSync(baseKeyV2) || isV7 ? 'sha256' : 'crc32',
    )

    if (checksumSpinner)
      checksumSpinner.stop(`Checksum: ${checksum}`)

    const mbSize = Math.floor(zipped.byteLength / 1024 / 1024)
    if (mbSize > alertMb && shouldShowPrompts) {
      log.warn(`WARNING !!\nThe bundle size is ${mbSize} Mb, this may take a while to download for users\n`)
      log.warn('Learn how to optimize your assets https://capgo.app/blog/optimise-your-images-for-updates/\n')
    }

    const saveSpinner = shouldShowPrompts ? spinner() : null
    const filename = options.name || `${resolvedAppId}_${bundle}.zip`

    if (saveSpinner)
      saveSpinner.start(`Saving to ${filename}`)

    writeFileSync(filename, zipped)

    if (saveSpinner)
      saveSpinner.stop(`Saved to ${filename}`)

    if (shouldShowPrompts)
      outro('Done ✅')

    if (!silent && json) {
      emitJson({
        bundle,
        filename,
        checksum,
      })
    }

    return {
      bundle,
      filename,
      checksum,
    }
  }
  catch (error) {
    if (!silent) {
      if (json)
        emitJsonError(error)
      else
        log.error(formatError(error))
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export async function zipBundle(appId: string, options: Options) {
  await zipBundleInternal(appId, options, false)
}
