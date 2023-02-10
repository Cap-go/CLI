import { readFileSync } from "fs"
import getLatest from "get-latest-version"
import { join } from "path"
import pack from '../../package.json'

const getLatestDependencies = async (installedDependencies: { [key: string]: string }) => {
    const latestDependencies: { [key: string]: string } = {}
    for (const dependency in installedDependencies) {
        // get in npm the last version of the dependency
        const v = await getLatest(dependency)
        if (v) {
            latestDependencies[dependency] = v
        }
    }
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
        if (dependency.startsWith('@capgo/')) {
            installedDependencies[dependency] = dependencies[dependency]
        }
    }
    return installedDependencies
}

export const getInfo = async () => {
    console.log('     💊   Capgo Doctor  💊')
    console.log('\n')
    console.log(' Latest Dependencies:')
    console.log('\n')
    const installedDependencies = await getInstalledDependencies()
    if (Object.keys(installedDependencies).length === 0) {
        console.log('\n')
        // display in red color in shell with console log
        console.log('\x1b[31m%s\x1b[0m', '🚨 No dependencies found')
        process.exit(1)
    }
    // eslint-disable-next-line guard-for-in
    for (const dependency in installedDependencies) {
        const installedVersion = (installedDependencies as any)[dependency]
        console.log(`   ${dependency}: ${installedVersion}`)
    }
    console.log('\n')
    console.log(' Installed Dependencies:')
    console.log('\n')
    const latestDependencies = await getLatestDependencies(installedDependencies)
    // eslint-disable-next-line guard-for-in
    for (const dependency in latestDependencies) {
        const latestVersion = (latestDependencies as any)[dependency]
        console.log(`   ${dependency}: ${latestVersion}`)
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
