import { dirname, join } from 'node:path'
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs'

export const CONFIG_FILE_NAME_TS = 'capacitor.config.ts'
export const CONFIG_FILE_NAME_JSON = 'capacitor.config.json'

export interface CapacitorConfig {
  appId: string
  appName: string
  webDir: string
  plugins?: Record<string, any>
  android?: Record<string, any>
  [key: string]: any
}

interface ExtConfigPairs {
  config: CapacitorConfig
  path: string
}

function parseConfigObject(configString: string): CapacitorConfig {
  // Remove comments
  const noComments = configString.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')

  // Parse the object
  // eslint-disable-next-line no-new-func
  const configObject = Function(`return ${noComments.trim()}`)()

  return configObject as CapacitorConfig
}

function loadConfigTs(content: string): CapacitorConfig {
  const configRegex = /const\s+config\s*:\s*CapacitorConfig\s*=\s*(\{[\s\S]*?\n\})/
  const match = content.match(configRegex)

  if (!match) {
    throw new Error('Unable to find config object in TypeScript file')
  }

  return parseConfigObject(match[1])
}

function loadConfigJson(content: string): CapacitorConfig {
  return JSON.parse(content) as CapacitorConfig
}

export async function loadConfig(): Promise<ExtConfigPairs | undefined> {
  const cliRootDir = dirname(__dirname)
  const extConfigFilePathTS = join(cliRootDir, CONFIG_FILE_NAME_TS)
  const extConfigFilePathJSON = join(cliRootDir, CONFIG_FILE_NAME_JSON)

  try {
    accessSync(extConfigFilePathTS, constants.R_OK)
    const configContentTS = readFileSync(extConfigFilePathTS, 'utf-8')
    return {
      config: loadConfigTs(configContentTS),
      path: extConfigFilePathTS,
    }
  }
  catch (err) {
    try {
      accessSync(extConfigFilePathJSON, constants.R_OK)
      const configContentJSON = readFileSync(extConfigFilePathJSON, 'utf-8')
      return {
        config: loadConfigJson(configContentJSON),
        path: extConfigFilePathJSON,
      }
    }
    catch (err) {
      console.error('Cannot find capacitor.config.ts or capacitor.config.json')
      return undefined
    }
  }
}

export async function writeConfig(config: ExtConfigPairs): Promise<void> {
  const { config: newConfig, path } = config
  const content = readFileSync(path, 'utf-8')

  const updatedContent = path.endsWith('.json')
    ? updateJsonContent(content, newConfig)
    : updateTsContent(content, newConfig)

  // Use writeFileSync with 'utf8' encoding to ensure proper handling of line endings
  writeFileSync(path, updatedContent, { encoding: 'utf8' })
}

function updateJsonContent(content: string, newConfig: CapacitorConfig): string {
  const jsonObj = JSON.parse(content)
  if (!jsonObj.plugins)
    jsonObj.plugins = {}
  if (!jsonObj.plugins.CapacitorUpdater)
    jsonObj.plugins.CapacitorUpdater = {}

  Object.assign(jsonObj.plugins.CapacitorUpdater, newConfig.plugins?.CapacitorUpdater)

  return JSON.stringify(jsonObj, null, detectIndentation(content))
}

function updateTsContent(content: string, newConfig: CapacitorConfig): string {
  const capUpdaterRegex = /(\bCapacitorUpdater\s*:\s*\{[^}]*\})/g

  return content.replace(capUpdaterRegex, (match) => {
    const updatedSection = updateCapacitorUpdaterSection(match, newConfig.plugins?.CapacitorUpdater || {})
    return updatedSection
  })
}

function updateCapacitorUpdaterSection(section: string, newConfig: Record<string, any>): string {
  const lines = section.split('\n')
  const updatedLines = lines.map((line) => {
    // eslint-disable-next-line regexp/no-super-linear-backtracking
    const keyValueMatch = line.match(/^\s*(\w+)\s*:\s*(.+?),?\s*$/)
    if (keyValueMatch) {
      const [, key] = keyValueMatch
      if (key in newConfig) {
        const newValue = formatValue(newConfig[key])
        return line.replace(/:\s*.+/, `: ${newValue},`)
      }
    }
    return line
  })

  // Add new properties
  Object.entries(newConfig).forEach(([key, value]) => {
    if (!updatedLines.some(line => line.includes(`${key}:`))) {
      const indent = detectIndentation(section)
      updatedLines.splice(-1, 0, `${' '.repeat(indent)}${key}: ${formatValue(value)},`)
    }
  })

  return updatedLines.join('\n')
}

function formatValue(value: any): string {
  if (typeof value === 'string') {
    // Convert multiline strings (like RSA keys) to single line
    if (value.includes('\n')) {
      return `'${value.replace(/\n/g, '\\n')}'`
    }
    return `'${value}'`
  }
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (Array.isArray(value))
    return `[${value.map(formatValue).join(', ')}]`
  if (typeof value === 'object' && value !== null) {
    return `{ ${Object.entries(value).map(([k, v]) => `${k}: ${formatValue(v)}`).join(', ')} }`
  }
  return 'null'
}

function detectIndentation(content: string): number {
  const match = content.match(/^( +)/m)
  return match ? match[1].length : 2
}
