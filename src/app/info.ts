import { platform, version } from 'node:os'
import { version as nodeVersion } from 'node:process'
import { log, spinner } from '@clack/prompts'
import latestVersion from 'latest-version'
import pack from '../../package.json'
import { getAllPackagesDependencies, getAppId, getBundleVersion, getConfig } from '../utils'

async function getLatestDependencies(installedDependencies: Record<string, string>) {
  const latestDependencies: Record<string, string> = {}
  const keys = Object.keys(installedDependencies)
  const versions = await Promise.all(keys.map(dependency => latestVersion(dependency).catch(() => null)))

  versions.forEach((v, index) => {
    if (v)
      latestDependencies[keys[index]] = v
  })

  return latestDependencies
}

async function getInstalledDependencies() {
  const dependencies = await getAllPackagesDependencies()
  const installedDependencies: Record<string, string> = {
    '@capgo/cli': pack.version,
  }

  for (const [dependency, depVersion] of dependencies) {
    if (dependency.startsWith('@capgo/') || dependency.startsWith('@capawesome/') || dependency.startsWith('capacitor'))
      installedDependencies[dependency] = depVersion
  }

  return installedDependencies
}

interface DoctorInfoOptions {
  packageJson?: string
}

export async function getInfo(options: DoctorInfoOptions, silent = false) {
  if (!silent)
    log.warn(' 💊   Capgo Doctor  💊')

  const extConfig = await getConfig()
  const pkgVersion = getBundleVersion('', options.packageJson)
  const appVersion = extConfig?.config?.plugins?.CapacitorUpdater?.version || pkgVersion
  const appName = extConfig?.config?.appName || ''
  const appId = getAppId('', extConfig?.config)
  const webDir = extConfig?.config?.webDir || ''

  if (!silent) {
    log.info(` App Name: ${appName}`)
    log.info(` App ID: ${appId}`)
    log.info(` App Version: ${appVersion}`)
    log.info(` Web Dir: ${webDir}`)
    log.info(` OS: ${platform()} ${version()}`)
    log.info(` Node: ${nodeVersion}`)
    log.info(' Installed Dependencies:')
  }

  const installedDependencies = await getInstalledDependencies()

  if (Object.keys(installedDependencies).length === 0) {
    if (!silent)
      log.warning('\x1B[31m%s\x1B[0m 🚨 No dependencies found')
    throw new Error('No dependencies found')
  }

  if (!silent) {
    for (const dependency of Object.keys(installedDependencies))
      log.info(`   ${dependency}: ${installedDependencies[dependency]}`)
  }

  let latestDependencies: Record<string, string> = {}

  if (!silent) {
    const s = spinner()
    s.start('Running: Loading latest dependencies')
    latestDependencies = await getLatestDependencies(installedDependencies)
    s.stop('Latest Dependencies:')

    for (const dependency of Object.keys(latestDependencies))
      log.info(`   ${dependency}: ${latestDependencies[dependency]}`)
  }
  else {
    latestDependencies = await getLatestDependencies(installedDependencies)
  }

  if (JSON.stringify(installedDependencies) !== JSON.stringify(latestDependencies)) {
    if (!silent)
      log.warn('\x1B[31m🚨 Some dependencies are not up to date\x1B[0m')
    throw new Error('Some dependencies are not up to date')
  }

  if (!silent)
    log.success('\x1B[32m✅ All dependencies are up to date\x1B[0m')

  return {
    appName,
    appId,
    appVersion,
    webDir,
    installedDependencies,
    latestDependencies,
  }
}
