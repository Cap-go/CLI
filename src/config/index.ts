import { loadConfig as loadConfigCap, writeConfig as writeConfigCap } from '@capacitor/cli/dist/config'

export interface CapacitorConfig {
  appId: string
  appName: string
  webDir: string
  plugins?: Record<string, any>
  android?: Record<string, any>
  [key: string]: any
}

export interface ExtConfigPairs {
  config: CapacitorConfig
  path: string
}

export async function loadConfig(): Promise<ExtConfigPairs | undefined> {
  const config = await loadConfigCap()
  return {
    config: config.app.extConfig,
    path: config.app.extConfigFilePath,
  }
}

export async function writeConfig(key: string, config: ExtConfigPairs, raw = false): Promise<void> {
  const oldConfig = await loadConfigCap()

  let { extConfig } = oldConfig.app
  if (extConfig) {
    if (!extConfig.plugins) {
      extConfig.plugins = {
        extConfig: {},
        [key]: {},
      }
    }
    if (!extConfig.plugins[key])
      extConfig.plugins[key] = {}

    if (!raw)
      extConfig.plugins[key] = config.config.plugins?.[key]
    else
      extConfig = config.config
    writeConfigCap(extConfig, oldConfig.app.extConfigFilePath)
  }
}

export async function writeConfigUpdater(config: ExtConfigPairs, raw = false): Promise<void> {
  await writeConfig('CapacitorUpdater', config, raw)
}
