import { log } from '@clack/prompts'
import latestVersion from 'latest-version'
import pack from '../../package.json'

export async function checkLatest() {
  const latest = await latestVersion('@capgo/cli')
  const major = latest?.split('.')[0]
  if (latest !== pack.version) {
    log.warning(`🚨 You are using @capgo/cli@${pack.version} it's not the latest version.
Please use @capgo/cli@${latest}" or @capgo/cli@${major} to keep up to date with the latest features and bug fixes.`,
    )
  }
}
