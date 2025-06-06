import type { OptionsBase } from '../utils'
import { intro, log } from '@clack/prompts'
import { Table } from '@sauber/table'
import { program } from 'commander'
// We only use semver from std for Capgo semver, others connected to package.json need npm one as it's not following the semver spec
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { checkCompatibility, createSupabaseClient, findSavedKey, formatError, getAppId, getConfig, isCompatible, OrganizationPerm, verifyUser } from '../utils'

interface Options extends OptionsBase {
  channel?: string
  text?: boolean
  packageJson?: string
  nodeModules?: string
}

export async function checkCompatibilityCommand(appId: string, options: Options) {
  intro(`Check compatibility`)
  try {
    options.apikey = options.apikey || findSavedKey()
    const extConfig = await getConfig()
    appId = getAppId(appId, extConfig?.config)

    const { channel } = options

    if (!channel) {
      log.error('Missing argument, you need to provide a channel')
      program.error('')
    }

    if (!options.apikey) {
      log.error('Missing API key, you need to provide a API key to upload your bundle')
      program.error('')
    }
    if (!appId) {
      log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
      program.error('')
    }

    const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
    await verifyUser(supabase, options.apikey, ['write', 'all', 'read', 'upload'])

    // Check we have app access to this appId
    await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.read)

    // const hashedLocalDependencies = new Map(dependenciesObject
    //     .filter((a) => !!a.native && a.native !== undefined)
    //     .map((a) => [a.name, a]))

    // const nativePackages = Array.from(hashedLocalDependencies, ([name, value]) => ({ name, version: value.version }))
    // await supabase.from('app_versions').update({ native_packages: nativePackages }).eq('id', '9654')

    const { finalCompatibility } = await checkCompatibility(supabase, appId, channel, options.packageJson, options.nodeModules)

    const t = new Table()
    t.headers = ['Package', 'Local version', 'Remote version', 'Compatible']
    t.theme = Table.roundTheme
    t.rows = []

    const yesSymbol = options.text ? 'Yes' : '✅'
    const noSymbol = options.text ? 'No' : '❌'

    finalCompatibility.forEach((data) => {
      const { name, localVersion, remoteVersion } = data
      const compatible = isCompatible(data) ? yesSymbol : noSymbol
      t.rows.push([name, localVersion, remoteVersion, compatible])
    })

    log.success('Compatibility')
    log.success(t.toString())
  }
  catch (err) {
    log.error(`Error checking compatibility ${formatError(err)}`)
    program.error('')
  }
}
