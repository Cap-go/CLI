import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs'
import { AST_NODE_TYPES, parse as parseTS } from '@typescript-eslint/typescript-estree'

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

export interface ExtConfigPairs {
  config: CapacitorConfig
  path: string
}

function loadConfigTs(content: string): CapacitorConfig {
  const ast = parseTS(content, { jsx: true })
  let config: CapacitorConfig | null = null

  // Find the config object in the AST
  const traverse = (node: any) => {
    if (node.type === 'VariableDeclaration' && node.declarations[0]?.id?.name === 'config') {
      config = JSON.parse(JSON.stringify(node.declarations[0].init.properties.reduce((acc: any, prop: any) => {
        acc[prop.key.name] = prop.value.type === 'ObjectExpression'
          ? prop.value.properties.reduce((obj: any, p: any) => {
            obj[p.key.name] = p.value.type === 'ArrayExpression'
              ? p.value.elements.map((el: any) => el.value)
              : p.value.value
            return obj
          }, {})
          : prop.value.value
        return acc
      }, {})))
    }
    if (node.body)
      node.body.forEach(traverse)
  }

  traverse(ast.body[0])

  if (!config) {
    throw new Error('Unable to parse TypeScript config')
  }

  return config
}

function loadConfigJson(content: string): CapacitorConfig {
  return JSON.parse(content) as CapacitorConfig
}

export async function loadConfig(): Promise<ExtConfigPairs | undefined> {
  const appRootDir = cwd()
  // check if extConfigFilePathTS exist
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

  if (path.endsWith('.json')) {
    await writeConfigJson(path, content, newConfig)
  }
  else if (path.endsWith('.ts')) {
    await writeConfigTs(path, content, newConfig)
  }
  else {
    throw new Error('Unsupported file type')
  }
}

async function writeConfigJson(path: string, content: string, newConfig: CapacitorConfig): Promise<void> {
  const jsonConfig = JSON.parse(content)
  const updatedContent = JSON.stringify(
    { ...jsonConfig, ...newConfig },
    null,
    detectIndentation(content),
  )
  writeFileSync(path, updatedContent)
}

async function writeConfigTs(path: string, content: string, newConfig: CapacitorConfig): Promise<void> {
  const ast = parseTS(content, { jsx: true, comment: true, tokens: true })
  let configNode: any = null

  // Find the config object in the AST
  const findConfigNode = (node: any) => {
    if (
      node.type === AST_NODE_TYPES.VariableDeclaration
      && node.declarations[0]?.id?.name === 'config'
    ) {
      configNode = node.declarations[0].init
      return
    }
    if (node.body)
      node.body.forEach(findConfigNode)
  }

  findConfigNode(ast.body[0])

  if (!configNode) {
    throw new Error('Unable to find config object in TypeScript file')
  }

  // Update the AST with new config values
  updateConfigNode(configNode, newConfig)

  // Regenerate the code while preserving comments and formatting
  const updatedContent = regenerateCode(content, ast, configNode)
  writeFileSync(path, updatedContent)
}

function updateConfigNode(node: any, newConfig: CapacitorConfig): void {
  node.properties.forEach((prop: any) => {
    const key = prop.key.name
    if (key in newConfig) {
      if (typeof newConfig[key] === 'object' && newConfig[key] !== null) {
        if (prop.value.type === AST_NODE_TYPES.ObjectExpression) {
          updateConfigNode(prop.value, newConfig[key])
        }
        else {
          prop.value = createObjectExpression(newConfig[key])
        }
      }
      else {
        prop.value = createLiteral(newConfig[key])
      }
    }
  })
}

function createObjectExpression(obj: Record<string, any>): any {
  return {
    type: AST_NODE_TYPES.ObjectExpression,
    properties: Object.entries(obj).map(([key, value]) => ({
      type: AST_NODE_TYPES.Property,
      key: { type: AST_NODE_TYPES.Identifier, name: key },
      value: typeof value === 'object' && value !== null
        ? createObjectExpression(value)
        : createLiteral(value),
      computed: false,
      method: false,
      shorthand: false,
    })),
  }
}

function createLiteral(value: any): any {
  return {
    type: AST_NODE_TYPES.Literal,
    value,
    raw: JSON.stringify(value),
  }
}

function regenerateCode(originalContent: string, ast: any, configNode: any): string {
  const lines = originalContent.split('\n')
  const updatedConfigString = JSON.stringify(configNode, null, detectIndentation(originalContent))
    .replace(/"([^"]+)":/g, '$1:')
    .replace(/"/g, '\'')

  const startLine = configNode.loc.start.line - 1
  const endLine = configNode.loc.end.line - 1

  const updatedLines = [
    ...lines.slice(0, startLine),
    ...updatedConfigString.split('\n'),
    ...lines.slice(endLine + 1),
  ]

  return updatedLines.join('\n')
}

function detectIndentation(content: string): number {
  const match = content.match(/^( +)/m)
  return match ? match[1].length : 2
}
