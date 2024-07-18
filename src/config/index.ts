import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs'

export const CONFIG_FILE_NAME_TS = 'capacitor.config.ts'
export const CONFIG_FILE_NAME_JSON = 'capacitor.config.json'

interface CapacitorConfig {
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
  const appRootDir = cwd()
  const extConfigFilePathTS = resolve(appRootDir, CONFIG_FILE_NAME_TS)
  const extConfigFilePathJSON = resolve(appRootDir, CONFIG_FILE_NAME_JSON)

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

  writeFileSync(path, updatedContent)
}

function updateJsonContent(content: string, newConfig: CapacitorConfig): string {
  const jsonRegex = /(\{[\s\S]*\})/
  const jsonMatch = content.match(jsonRegex)

  if (!jsonMatch) {
    throw new Error('Unable to find JSON object in file')
  }

  const existingConfig = JSON.parse(jsonMatch[1])
  const updatedConfig = deepMerge(existingConfig, newConfig)

  // Custom replacer function to handle multiline strings
  const replacer = (key: string, value: any) => {
    if (key === 'privateKey' && typeof value === 'string' && value.includes('\n')) {
      return value.replace(/\n/g, '\\n')
    }
    return value
  }

  const updatedJsonString = JSON.stringify(updatedConfig, replacer, detectIndentation(content))

  return content.replace(jsonRegex, updatedJsonString)
}

function updateTsContent(content: string, newConfig: CapacitorConfig): string {
  const configRegex = /(const\s+config\s*:\s*CapacitorConfig\s*=\s*)(\{[\s\S]*?\n\})/
  const configMatch = content.match(configRegex)

  if (!configMatch) {
    throw new Error('Unable to find config object in TypeScript file')
  }

  const [, prefix, configString] = configMatch
  const existingConfig = parseConfigObject(configString)
  const updatedConfig = deepMerge(existingConfig, newConfig)
  const updatedConfigString = stringifyConfig(updatedConfig, detectIndentation(content))

  return content.replace(configRegex, `${prefix}${updatedConfigString}`)
}

function stringifyConfig(config: CapacitorConfig, indent: number): string {
  const stringifyValue = (value: any, level: number, key: string = ''): string => {
    if (typeof value === 'string') {
      // Convert multiline strings (like RSA keys) to single line
      if (key === 'privateKey' && value.includes('\n')) {
        return `'${value.replace(/\n/g, '\\n')}'`
      }
      return `'${value}'`
    }
    if (typeof value === 'number' || typeof value === 'boolean')
      return String(value)
    if (Array.isArray(value)) {
      return `[${value.map(v => stringifyValue(v, level + 1)).join(', ')}]`
    }
    if (typeof value === 'object' && value !== null) {
      const innerIndent = ' '.repeat((level + 1) * indent)
      const entries = Object.entries(value).map(([k, v]) =>
        `${innerIndent}${k}: ${stringifyValue(v, level + 1, k)}`,
      ).join(',\n')
      return `{\n${entries}\n${' '.repeat(level * indent)}}`
    }
    return 'null'
  }

  return stringifyValue(config, 0)
}

function deepMerge(target: any, source: any): any {
  const output = Object.assign({}, target)
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target))
          Object.assign(output, { [key]: source[key] })
        else
          output[key] = deepMerge(target[key], source[key])
      }
      else {
        Object.assign(output, { [key]: source[key] })
      }
    })
  }
  return output
}

function isObject(item: any): boolean {
  return (item && typeof item === 'object' && !Array.isArray(item))
}

function detectIndentation(content: string): number {
  const match = content.match(/^( +)/m)
  return match ? match[1].length : 2
}
