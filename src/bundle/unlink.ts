import process from 'node:process'
import { program } from 'commander'
import * as p from '@clack/prompts'
import { getVersionData } from '../api/versions'
import { checkVersionNotUsedInDeviceOverride } from '../api/devices_override'
import { checkVersionNotUsedInChannel } from '../api/channels'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import type {
  OptionsBase,
} from '../utils'
import {
  OrganizationPerm,
  checkPlanValid,
  createSupabaseClient,
  findSavedKey,
  formatError,
  getConfig,
  getOrganizationId,
  useLogSnag,
  verifyUser,
} from '../utils'

interface Options extends OptionsBase {
  bundle?: string
}

export async function unlinkDevice(channel: string, appId: string, options: Options) {
  p.intro(`Unlink bundle ${options.apikey}`)
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig()
  appId = appId || config?.app?.appId
  const snag = useLogSnag()
  let { bundle } = options

  bundle = bundle || config?.app?.package?.version

  if (!options.apikey) {
    p.log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }
  if (!bundle) {
    p.log.error('Missing argument, you need to provide a bundle, or be in a capacitor project')
    program.error('')
  }
  const supabase = await createSupabaseClient(options.apikey)

  const [userId, orgId] = await Promise.all([
    verifyUser(supabase, options.apikey, ['all', 'write']),
    getOrganizationId(supabase, appId),
  ])

  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.write)

  if (!channel) {
    p.log.error('Missing argument, you need to provide a channel')
    program.error('')
  }
  try {
    await checkPlanValid(supabase, orgId, options.apikey, appId)

    const versionData = await getVersionData(supabase, appId, bundle)
    await checkVersionNotUsedInChannel(supabase, appId, versionData)
    await checkVersionNotUsedInDeviceOverride(supabase, appId, versionData)
    await snag.track({
      channel: 'bundle',
      event: 'Unlink bundle',
      icon: '✅',
      user_id: userId,
      tags: {
        'app-id': appId,
      },
      notify: false,
    }).catch()
  }
  catch (err) {
    p.log.error(`Unknow error ${formatError(err)}`)
    program.error('')
  }
  p.outro('Done ✅')
  process.exit()
}
