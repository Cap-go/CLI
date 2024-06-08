import process from 'node:process'
import { program } from 'commander'
import * as p from '@clack/prompts'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import type { OptionsBase } from '../utils'
import { OrganizationPerm, createSupabaseClient, findSavedKey, formatError, getConfig, getOrganizationId, useLogSnag, verifyUser } from '../utils'

export async function deleteApp(appId: string, options: OptionsBase) {
  p.intro(`Deleting`)
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig()
  appId = appId || config?.app?.appId
  const snag = useLogSnag()

  if (!options.apikey) {
    p.log.error('Missing API key, you need to provide a API key to upload your bundle')
    program.error('')
  }
  if (!appId) {
    p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    program.error('')
  }
  const supabase = await createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.super_admin)

  const { data: appOwnerRaw, error: appOwnerError } = await supabase.from('apps')
    .select(`owner_org ( created_by, id )`)
    .eq('app_id', appId)
    .single()

  const appOwner = appOwnerRaw as { owner_org: { created_by: string, id: string } } | null

  if (!appOwnerError && (appOwner?.owner_org.created_by ?? '') !== userId) {
    // We are dealing with a member user that is not the owner
    // Deleting the app is not recomended at this stage

    p.log.warn('Deleting the app is not recomended for users that are not the organization owner')
    p.log.warn('You are invited as a super_admin but your are not the owner')
    p.log.warn('It\'s strongly recomended that you do not continue!')

    const shouldContinue = await p.select({
      message: 'Do you want to continue?',
      options: [
        {
          label: 'Yes',
          value: 'yes',
        },
        {
          label: 'No',
          value: 'no',
        },
      ],
    })

    if (p.isCancel(shouldContinue) || shouldContinue === 'no') {
      p.log.error('Canceled deleting the app, exiting')
      program.error('')
    }
  }
  else if (appOwnerError) {
    p.log.warn(`Cannot get the app owner ${formatError(appOwnerError)}`)
  }

  const { error } = await supabase
    .storage
    .from(`images`)
    .remove([`org/${appOwner?.owner_org.id}/${appId}/icon`])
  if (error) {
    console.error(error, `images/org/${appOwner?.owner_org.id}/${appId}`)
    p.log.error('Could not delete app logo')
  }

  // TODO: make the version delete in R2 too
  const { error: delError } = await supabase
    .storage
    .from(`apps/${appId}/${userId}`)
    .remove(['versions'])
  if (delError)
    p.log.error('Could not delete app version')
  // We should not care too much, most is in r2 anyways :/
  // program.error('')

  const { error: dbError } = await supabase
    .from('apps')
    .delete()
    .eq('app_id', appId)
    // .eq('user_id', userId)

  if (dbError) {
    p.log.error('Could not delete app')
    program.error('')
  }
  const orgId = await getOrganizationId(supabase, appId)
  await snag.track({
    channel: 'app',
    event: 'App Deleted',
    icon: '🗑️',
    user_id: orgId,
    tags: {
      'app-id': appId,
    },
    notify: false,
  }).catch()
  p.log.success(`App deleted in Capgo`)
  p.outro('Done ✅')
  process.exit()
}
