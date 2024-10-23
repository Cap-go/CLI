import type { OptionsBase } from '../utils'
import { intro, log } from '@clack/prompts'
import { Table } from '@sauber/table'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { checkCompatibility, createSupabaseClient, findSavedKey, getConfig, OrganizationPerm, verifyUser } from '../utils'

interface Options extends OptionsBase {
  channel?: string
  text?: boolean
  packageJson?: string
}

export async function checkCompatibilityCommand(appId: string, options: Options) {
  intro(`Check compatibility`)
  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
  appId = appId || extConfig?.config?.appId

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

  const supabase = await createSupabaseClient(options.apikey)
  await verifyUser(supabase, options.apikey, ['write', 'all', 'read', 'upload'])

  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.read)

  // const hashedLocalDependencies = new Map(dependenciesObject
  //     .filter((a) => !!a.native && a.native !== undefined)
  //     .map((a) => [a.name, a]))

  // const nativePackages = Array.from(hashedLocalDependencies, ([name, value]) => ({ name, version: value.version }))
  // await supabase.from('app_versions').update({ native_packages: nativePackages }).eq('id', '9654')

  const { finalCompatibility } = await checkCompatibility(supabase, appId, channel, options.packageJson)

  const t = new Table()
  t.headers = ['Package', 'Local version', 'Remote version', 'Compatible']
  t.theme = Table.roundTheme
  t.rows = []

  const yesSymbol = options.text ? 'Yes' : '✅'
  const noSymbol = options.text ? 'No' : '❌'

  finalCompatibility.forEach((data) => {
    const { name, localVersion, remoteVersion } = data
    const compatible = remoteVersion === localVersion ? yesSymbol : noSymbol
    t.rows.push([name, localVersion, remoteVersion, compatible])
  })

  log.success('Compatibility')
  log.success(t.toString())
}
