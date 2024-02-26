import process from 'node:process'
import { program } from 'commander'
import * as p from '@clack/prompts'
import { checkAppExistsAndHasPermissionErr } from '../api/app'
import type { OptionsBase } from '../utils'
import { createSupabaseClient, findSavedKey, getConfig, verifyUser } from '../utils'

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
    p.intro(`List current bundle`)

  options.apikey = options.apikey || findSavedKey(quiet)
  const config = await getConfig()
  appId = appId || config?.app?.appId

  if (!options.apikey) {
    p.log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }
  const supabase = await createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all', 'read'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionErr(supabase, options.apikey, appId)

  if (!channel) {
    p.log.error(`Please provide a channel to get the bundle from.`)
    program.error('')
  }

  const { data: supabaseChannel, error } = await supabase
    .from('channels')
    .select('version ( name )')
    .eq('name', channel)
    .eq('app_id', appId)
    .eq('created_by', userId)
    .limit(1)

  if (error || supabaseChannel.length === 0) {
    p.log.error(`Error retrieving channel ${channel} for app ${appId}. Perhaps the channel does not exists?`)
    program.error('')
  }

  const { version } = supabaseChannel[0] as any as Channel
  if (!version) {
    p.log.error(`Error retrieving channel ${channel} for app ${appId}. Perhaps the channel does not exists?`)
    program.error('')
  }

  if (!quiet)
    p.log.info(`Current bundle for channel ${channel} is ${version.name}`)
  else
    p.log.info(version.name)

  process.exit()
}
