import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import process from 'node:process'
import getLatest from 'get-latest-version'
import Spinnies from '@trufflesuite/spinnies'
import * as p from '@clack/prompts'
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

async function readPackageJson() {
  const packageJson = readFileSync(join(process.cwd(), 'package.json'))
  return JSON.parse(packageJson as any)
}

async function getInstalledDependencies() {
  const { dependencies } = await readPackageJson()
  const installedDependencies: { [key: string]: string } = {
    '@capgo/cli': pack.version,
  }
  for (const dependency in dependencies) {
    if (Object.prototype.hasOwnProperty.call(dependencies, dependency) && dependency.startsWith('@capgo/')) {
      // remove ^ or ~ from version
      const version = dependencies[dependency].replace('^', '').replace('~', '')
      installedDependencies[dependency] = version
    }
  }
  return installedDependencies
}

export async function getInfo() {
  p.log.info(' 💊   Capgo Doctor  💊\n')
  p.log.info(` OS: ${os.platform()} ${os.version()}\n`)
  p.log.info(` Node: ${process.version}\n`)
  p.log.info(' Installed Dependencies:\n')
  const installedDependencies = await getInstalledDependencies()
  if (Object.keys(installedDependencies).length === 0) {
    // display in red color in shell with console log
    p.log.warning('\x1B[31m%s\x1B[0m 🚨 No dependencies found')
    process.exit(1)
  }
  for (const dependency in installedDependencies) {
    if (Object.prototype.hasOwnProperty.call(installedDependencies, dependency)) {
      const installedVersion = (installedDependencies as any)[dependency]
      p.log.info(`   ${dependency}: ${installedVersion}`)
    }
  }
  p.log.info('\n')
  const spinnies = new Spinnies()
  spinnies.add('loading', { text: '  Loading latest dependencies' })
  const latestDependencies = await getLatestDependencies(installedDependencies)
  spinnies.succeed('loading', { text: '  Latest Dependencies:' })
  for (const dependency in latestDependencies) {
    if (Object.prototype.hasOwnProperty.call(latestDependencies, dependency)) {
      const latestVersion = (latestDependencies as any)[dependency]
      p.log.info(`   ${dependency}: ${latestVersion}`)
    }
  }
  if (JSON.stringify(installedDependencies) !== JSON.stringify(latestDependencies)) {
    // display in red color in shell with console log
    p.log.warn('\x1B[31m🚨 Some dependencies are not up to date\x1B[0m')
    process.exit(1)
  }
  // display in green color in shell with console log
  p.log.success('\x1B[32m✅ All dependencies are up to date\x1B[0m')
  process.exit()
}
