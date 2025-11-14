import { log } from '@clack/prompts'
import pack from '../../package.json'
import { getLatestVersion } from '../utils/latest-version'

export async function checkAlerts() {
  const latest = await getLatestVersion('@capgo/cli') ?? ''
  const major = latest?.split('.')[0]
  if (latest !== pack.version) {
    log.warning(`🚨 You are using @capgo/cli@${pack.version} it's not the latest version.
Please use @capgo/cli@${latest}" or @capgo/cli@${major} to keep up to date with the latest features and bug fixes.`,
    )
  }
  // check if the app use old encryption key and if so alert the user it not secure enough and it should migrate on v2
}
