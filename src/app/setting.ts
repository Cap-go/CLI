import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { writeConfig } from '../config'
import { formatError, getConfig } from '../utils'

interface Options extends OptionsBase {
  bool?: string
  string?: string
}

export async function setSetting(setting: string, options: Options) {
  intro(`Set a specific setting in capacitor config`)

  if (options.bool && options.string) {
    log.error(`Bool and string CANNOT be set at the same time`)
    exit(1)
  }

  if (!options.bool && !options.string) {
    log.error(`You MUST provide either bool or string as the value`)
    exit(1)
  }

  if (options.bool && options.bool !== 'true' && options.bool !== 'false') {
    log.error(`Invalid bool`)
    exit(1)
  }

  try {
    const config = await getConfig()
    let baseObj = config.config as any
    const pathElements = setting.split('.')

    if (pathElements.length === 0) {
      log.error(`Invalid path`)
      exit(1)
    }

    for (const path of pathElements.slice(0, -1)) {
      if (!Object.prototype.hasOwnProperty.call(baseObj, path)) {
        baseObj[path] = {}
      }
      baseObj = baseObj[path]
    }

    const finalValue: boolean | string = options.bool ? options.bool === 'true' : options.string!

    baseObj[pathElements.at(-1)!] = finalValue
    await writeConfig(config, true)
    log.success(`Set "${setting}" to "${finalValue}"`)
  }
  catch (error) {
    log.error(`Cannot set config in capacitor settings ${formatError(error)}`)
    exit(1)
  }

  outro(`Done ✅`)
}
