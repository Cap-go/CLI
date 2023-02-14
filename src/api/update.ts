import getLatest from "get-latest-version"
import pack from '../../package.json'

export const checkLatest = async () => {
    const latest = await getLatest('@capgo/cli')
    if (latest !== pack.version) {
        console.log('\x1b[31m%s\x1b[0m', `🚨 You are using @capgo/cli@${pack.version} it's not the latest version.
Please use @capgo/cli@${latest}" or @capgo/cli@latest to keep up to date with the latest features and bug fixes.`)
    }
}