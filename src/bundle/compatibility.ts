import * as p from '@clack/prompts'
import { program } from 'commander'
import { Table } from 'console-table-printer'
import type { OptionsBase } from '../utils'
import { OrganizationPerm, checkCompatibility, createSupabaseClient, findSavedKey, getConfig, verifyUser } from '../utils'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'

interface Options extends OptionsBase {
  channel?: string
  text?: boolean
}

export async function checkCompatibilityCommand(appId: string, options: Options) {
  p.intro(`Check compatibility`)
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig()
  appId = appId || config?.app?.appId

  const { channel } = options

  if (!channel) {
    p.log.error('Missing argument, you need to provide a channel')
    program.error('')
  }

  if (!options.apikey) {
    p.log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
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

  const { finalCompatibility } = await checkCompatibility(supabase, appId, channel)

  const t = new Table({
    title: 'Compatibility',
    charLength: { '❌': 2, '✅': 2 },
  })

  const yesSymbol = options.text ? 'Yes' : '✅'
  const noSymbol = options.text ? 'No' : '❌'

  finalCompatibility.forEach((data) => {
    const { name, localVersion, remoteVersion } = data

    t.addRow({
      'Package': name,
      'Local version': localVersion ?? 'None',
      'Remote version': remoteVersion ?? 'None',
      'Compatible': remoteVersion === localVersion ? yesSymbol : noSymbol,
    })
  })

  p.log.success(t.render())
}
