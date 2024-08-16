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

export async function writeConfig(config: ExtConfigPairs, raw = false): Promise<void> {
  const oldConfig = await loadConfigCap()

  let { extConfig } = oldConfig.app
  if (extConfig) {
    if (!extConfig.plugins) {
      extConfig.plugins = {
        extConfig: {},
        CapacitorUpdater: {},
      }
    }
    if (!extConfig.plugins.CapacitorUpdater)
      extConfig.plugins.CapacitorUpdater = {}

    if (!raw)
      extConfig.plugins.CapacitorUpdater = config.config.plugins?.CapacitorUpdater
    else
      extConfig = config.config
    writeConfigCap(extConfig, oldConfig.app.extConfigFilePath)
  }
}
