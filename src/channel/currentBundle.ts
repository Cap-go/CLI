import { exit } from 'node:process'
import { intro, log } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { createSupabaseClient, findSavedKey, getConfig, OrganizationPerm, verifyUser } from '../utils'
import type { OptionsBase } from '../utils'

interface Options extends OptionsBase {
  channel?: string
  quiet?: boolean
}

interface Channel {
  version: {
    name: string
  }
}

export async function currentBundle(channel: string, appId: string, options: Options) {
  const { quiet } = options

  if (!quiet)
    intro(`List current bundle`)

  options.apikey = options.apikey || findSavedKey(quiet)
  const extConfig = await getConfig()
  appId = appId || extConfig?.config?.appId

  if (!options.apikey) {
    log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }
  const supabase = await createSupabaseClient(options.apikey)

  const _userId = await verifyUser(supabase, options.apikey, ['write', 'all', 'read'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.read)

  if (!channel) {
    log.error(`Please provide a channel to get the bundle from.`)
    program.error('')
  }

  const { data: supabaseChannel, error } = await supabase
    .from('channels')
    .select('version ( name )')
    .eq('name', channel)
    .eq('app_id', appId)
    .limit(1)

  if (error || supabaseChannel.length === 0) {
    log.error(`Error retrieving channel ${channel} for app ${appId}. Perhaps the channel does not exists?`)
    program.error('')
  }

  const { version } = supabaseChannel[0] as any as Channel
  if (!version) {
    log.error(`Error retrieving channel ${channel} for app ${appId}. Perhaps the channel does not exists?`)
    program.error('')
  }

  if (!quiet)
    log.info(`Current bundle for channel ${channel} is ${version.name}`)
  else
    log.info(version.name)

  exit()
}
