import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

export interface PbxTarget {
  name: string
  bundleId: string
  productType: string
}

const SIGNABLE_PRODUCT_TYPES = new Set([
  'com.apple.product-type.application',
  'com.apple.product-type.app-extension',
  'com.apple.product-type.app-extension.messages',
  'com.apple.product-type.app-extension.messages-sticker-pack',
  'com.apple.product-type.application.watchapp2',
  'com.apple.product-type.watchkit2-extension',
  'com.apple.product-type.extensionkit-extension',
  'com.apple.product-type.application.on-demand-install-capable',
])

/**
 * Parse a pbxproj file's content and return all signable native targets
 * with their resolved bundle identifiers.
 */
export function findSignableTargets(pbxprojContent: string): PbxTarget[] {
  if (!pbxprojContent) return []

  // Step 1: Find all PBXNativeTarget blocks
  const targetRegex = /(\w+)\s*\/\*[^*]*\*\/\s*=\s*\{[^}]*isa\s*=\s*PBXNativeTarget;[^}]*\}/g
  const targets: PbxTarget[] = []

  let match: RegExpExecArray | null
  while ((match = targetRegex.exec(pbxprojContent)) !== null) {
    const block = match[0]

    const nameMatch = block.match(/name\s*=\s*([^;]+);/)
    const productTypeMatch = block.match(/productType\s*=\s*"([^"]+)"/)
    const configListMatch = block.match(/buildConfigurationList\s*=\s*(\w+)/)

    if (!nameMatch || !productTypeMatch || !configListMatch) continue

    const name = nameMatch[1].trim()
    const productType = productTypeMatch[1]
    const configListId = configListMatch[1]

    if (!SIGNABLE_PRODUCT_TYPES.has(productType)) continue

    const bundleId = resolveBundleId(pbxprojContent, configListId)

    targets.push({ name, bundleId, productType })
  }

  return targets
}

/**
 * Given an XCConfigurationList ID, walk the pbxproj to find the
 * PRODUCT_BUNDLE_IDENTIFIER from the first build configuration.
 */
function resolveBundleId(content: string, configListId: string): string {
  // Find XCConfigurationList block for the given ID
  const configListRegex = new RegExp(
    `${escapeRegex(configListId)}\\s*\\/\\*[^*]*\\*\\/\\s*=\\s*\\{[^}]*isa\\s*=\\s*XCConfigurationList;[^}]*\\}`,
  )
  const configListMatch = content.match(configListRegex)
  if (!configListMatch) return ''

  // Extract first build configuration ID from buildConfigurations list
  const configIdsMatch = configListMatch[0].match(/buildConfigurations\s*=\s*\(\s*(\w+)/)
  if (!configIdsMatch) return ''
  const firstConfigId = configIdsMatch[1]

  // Find the XCBuildConfiguration block for that ID
  const buildConfigRegex = new RegExp(
    `${escapeRegex(firstConfigId)}\\s*\\/\\*[^*]*\\*\\/\\s*=\\s*\\{[^}]*isa\\s*=\\s*XCBuildConfiguration;[^}]*\\}`,
  )
  const buildConfigMatch = content.match(buildConfigRegex)
  if (!buildConfigMatch) return ''

  // Extract PRODUCT_BUNDLE_IDENTIFIER from buildSettings
  const bundleIdMatch = buildConfigMatch[0].match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";]+)"?\s*;/)
  return bundleIdMatch ? bundleIdMatch[1] : ''
}

/**
 * Search for an Xcode project.pbxproj file in standard locations:
 *   <searchDir>/ios/*.xcodeproj/project.pbxproj
 *   <searchDir>/*.xcodeproj/project.pbxproj
 * Returns the first found path, or null.
 */
export function findXcodeProject(searchDir: string): string | null {
  // Search ios/ subdirectory first (most common for Capacitor/RN projects)
  const iosDir = join(searchDir, 'ios')
  const found = findPbxprojInDir(iosDir)
  if (found) return found

  // Fall back to searching the root directory
  return findPbxprojInDir(searchDir)
}

function findPbxprojInDir(dir: string): string | null {
  if (!existsSync(dir)) return null

  let entries: string[]
  try {
    entries = readdirSync(dir)
  }
  catch {
    return null
  }

  for (const entry of entries) {
    if (entry.endsWith('.xcodeproj')) {
      const pbxprojPath = join(dir, entry, 'project.pbxproj')
      if (existsSync(pbxprojPath)) {
        return pbxprojPath
      }
    }
  }

  return null
}

/**
 * Convenience: find the Xcode project in projectDir and read its pbxproj content.
 * Returns null if no project is found.
 */
export function readPbxproj(projectDir: string): string | null {
  const pbxprojPath = findXcodeProject(projectDir)
  if (!pbxprojPath) return null

  try {
    return readFileSync(pbxprojPath, 'utf-8')
  }
  catch {
    return null
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
