import { readFileSync } from "fs"
import getLatest from "get-latest-version"
import { join } from "path"
import Spinnies from '@trufflesuite/spinnies';
import osName from 'os-name';
import pack from '../../package.json'

const getLatestDependencies = async (installedDependencies: { [key: string]: string }) => {
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
                if (v) {
                    latestDependencies[keys[i]] = v
                }
            }
        })
    return latestDependencies
}

const readPackageJson = async () => {
    const packageJson = readFileSync(join(process.cwd(), 'package.json'))
    return JSON.parse(packageJson as any)
}

const getInstalledDependencies = async () => {
    const { dependencies } = await readPackageJson()
    const installedDependencies: { [key: string]: string } = {
        '@capgo/cli': pack.version,
    }
    for (const dependency in dependencies) {
        if (Object.prototype.hasOwnProperty.call(dependencies, dependency) && dependency.startsWith('@capgo/')) {
            installedDependencies[dependency] = dependencies[dependency]
        }
    }
    return installedDependencies
}

export const getInfo = async () => {
    console.log('     💊   Capgo Doctor  💊\n')
    console.log(` OS: ${osName()}\n`)
    console.log(' Installed Dependencies:\n')
    const installedDependencies = await getInstalledDependencies()
    if (Object.keys(installedDependencies).length === 0) {
        console.log('\n')
        // display in red color in shell with console log
        console.log('\x1b[31m%s\x1b[0m', '🚨 No dependencies found')
        process.exit(1)
    }
    for (const dependency in installedDependencies) {
        if (Object.prototype.hasOwnProperty.call(installedDependencies, dependency)) {
            const installedVersion = (installedDependencies as any)[dependency]
            console.log(`   ${dependency}: ${installedVersion}`)
        }
    }
    console.log('\n')
    const spinnies = new Spinnies();
    spinnies.add('loading', { text: 'Loading latest dependencies' });
    const latestDependencies = await getLatestDependencies(installedDependencies)
    spinnies.succeed('loading', { text: 'Latest Dependencies:' });
    console.log('\n')
    for (const dependency in latestDependencies) {
        if (Object.prototype.hasOwnProperty.call(latestDependencies, dependency)) {
            const latestVersion = (latestDependencies as any)[dependency]
            console.log(`   ${dependency}: ${latestVersion}`)
        }
    }
    if (JSON.stringify(installedDependencies) !== JSON.stringify(latestDependencies)) {
        console.log('\n')
        // display in red color in shell with console log
        console.log('\x1b[31m%s\x1b[0m', '🚨 Some dependencies are not up to date')
        process.exit(1)
    }
    console.log('\n')
    // display in green color in shell with console log
    console.log('\x1b[32m%s\x1b[0m', '✅ All dependencies are up to date')
    process.exit()
}
