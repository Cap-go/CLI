import process from 'node:process'
import { program } from 'commander'
import * as p from '@clack/prompts'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { displayChannels, getActiveChannels } from '../api/channels'
import type { OptionsBase } from '../utils'
import { OrganizationPerm, createSupabaseClient, findSavedKey, getConfig, useLogSnag, verifyUser } from '../utils'

export async function listChannels(appId: string, options: OptionsBase) {
  p.intro(`List channels`)
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig()
  appId = appId || config?.app?.appId
  const snag = useLogSnag()

  if (!options.apikey)
    p.log.error('Missing API key, you need to provide a API key to upload your bundle')

  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }
  const supabase = await createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all', 'read', 'upload'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.read)

  p.log.info(`Querying available channels in Capgo`)

  // Get all active app versions we might possibly be able to cleanup
  const allVersions = await getActiveChannels(supabase, appId)

  p.log.info(`Active channels in Capgo: ${allVersions?.length}`)

  displayChannels(allVersions)
  await snag.track({
    channel: 'channel',
    event: 'List channel',
    icon: '✅',
    user_id: userId,
    tags: {
      'app-id': appId,
    },
    notify: false,
  }).catch()
  p.outro(`Done ✅`)
  process.exit()
}
