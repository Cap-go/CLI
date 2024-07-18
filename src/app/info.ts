import { exit, version as nodeVersion } from 'node:process'
import { platform, version } from 'node:os'
import getLatest from 'get-latest-version'
import { log, spinner } from '@clack/prompts'
import { readPackageJson } from '../utils'
import pack from '../../package.json'

async function getLatestDependencies(installedDependencies: { [key: string]: string }) {
  const latestDependencies: { [key: string]: string } = {}
  const all = []
  for (const dependency in installedDependencies) {
    if (Object.prototype.hasOwnProperty.call(installedDependencies, dependency)) {
      // get in npm the last version of the dependency
      all.push(getLatest(dependency))
    }
  }
  await Promise.all(all)
    .then((values) => {
      const keys = Object.keys(installedDependencies)
      for (let i = 0; i < values.length; i += 1) {
        const v = values[i]
        if (v)
          latestDependencies[keys[i]] = v
      }
    })
  return latestDependencies
}

async function getInstalledDependencies() {
  const { dependencies } = await readPackageJson()
  const installedDependencies: { [key: string]: string } = {
    '@capgo/cli': pack.version,
  }
  for (const dependency in dependencies) {
    if (Object.prototype.hasOwnProperty.call(dependencies, dependency)
      && dependency.startsWith('@capgo/')
      && dependency.startsWith('@capawesome/')
      && dependency.startsWith('capacitor')) {
      // remove ^ or ~ from version
      const version = dependencies[dependency].replace('^', '').replace('~', '')
      installedDependencies[dependency] = version
    }
  }
  return installedDependencies
}

export async function getInfo() {
  log.info(' 💊   Capgo Doctor  💊\n')
  log.info(` OS: ${platform()} ${version()}\n`)
  log.info(` Node: ${nodeVersion}\n`)
  log.info(' Installed Dependencies:\n')
  const installedDependencies = await getInstalledDependencies()
  if (Object.keys(installedDependencies).length === 0) {
    // display in red color in shell with console log
    log.warning('\x1B[31m%s\x1B[0m 🚨 No dependencies found')
    exit(1)
  }
  for (const dependency in installedDependencies) {
    if (Object.prototype.hasOwnProperty.call(installedDependencies, dependency)) {
      const installedVersion = (installedDependencies as any)[dependency]
      log.info(`   ${dependency}: ${installedVersion}`)
    }
  }
  log.info('\n')
  const s = spinner()
  s.start(`Running: Loading latest dependencies`)
  const latestDependencies = await getLatestDependencies(installedDependencies)
  s.stop(`Latest Dependencies:`)
  for (const dependency in latestDependencies) {
    if (Object.prototype.hasOwnProperty.call(latestDependencies, dependency)) {
      const latestVersion = (latestDependencies as any)[dependency]
      log.info(`   ${dependency}: ${latestVersion}`)
    }
  }
  if (JSON.stringify(installedDependencies) !== JSON.stringify(latestDependencies)) {
    // display in red color in shell with console log
    log.warn('\x1B[31m🚨 Some dependencies are not up to date\x1B[0m')
    exit(1)
  }
  // display in green color in shell with console log
  log.success('\x1B[32m✅ All dependencies are up to date\x1B[0m')
  exit()
}
