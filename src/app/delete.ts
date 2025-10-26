import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { intro, isCancel, log, outro, select } from '@clack/prompts'
import { program } from 'commander'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { createSupabaseClient, findSavedKey, formatError, getAppId, getConfig, getOrganizationId, OrganizationPerm, sendEvent, verifyUser } from '../utils'

export async function deleteApp(appId: string, options: OptionsBase, shouldExit = true, skipConfirmation = false) {
  if (shouldExit)
    intro(`Deleting`)
  options.apikey = options.apikey || findSavedKey()
  const extConfig = await getConfig()
  appId = getAppId(appId, extConfig?.config)

  if (!options.apikey) {
    log.error('Missing API key, you need to provide an API key to upload your bundle')
    if (shouldExit)
      program.error('')
    throw new Error('Missing API key')
  }
  if (!appId) {
    log.error('Missing argument, you need to provide a appId, or be in a capacitor project')
    if (shouldExit)
      program.error('')
    throw new Error('Missing appId')
  }
  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)

  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])
  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.super_admin)

  const { data: appOwnerRaw, error: appOwnerError } = await supabase.from('apps')
    .select(`owner_org ( created_by, id )`)
    .eq('app_id', appId)
    .single()

  const appOwner = appOwnerRaw as { owner_org: { created_by: string, id: string } } | null

  if (!skipConfirmation && !appOwnerError && (appOwner?.owner_org.created_by ?? '') !== userId) {
    // We are dealing with a member user that is not the owner
    // Deleting the app is not recomended at this stage

    if (shouldExit) {
      log.warn('Deleting the app is not recomended for users that are not the organization owner')
      log.warn('You are invited as a super_admin but your are not the owner')
      log.warn('It\'s strongly recomended that you do not continue!')

      const shouldContinue = await select({
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

      if (isCancel(shouldContinue) || shouldContinue === 'no') {
        log.error('Canceled deleting the app, exiting')
        program.error('')
      }
    }
    else {
      // SDK mode - don't allow deletion if not owner
      throw new Error('Cannot delete app: you are not the organization owner')
    }
  }
  else if (appOwnerError) {
    log.warn(`Cannot get the app owner ${formatError(appOwnerError)}`)
  }

  const { error } = await supabase
    .storage
    .from(`images`)
    .remove([`org/${appOwner?.owner_org.id}/${appId}/icon`])
  if (error) {
    console.error(error, `images/org/${appOwner?.owner_org.id}/${appId}`)
    log.error('Could not delete app logo')
  }

  // TODO: make the version delete in R2 too
  const { error: delError } = await supabase
    .storage
    .from(`apps/${appId}/${userId}`)
    .remove(['versions'])
  if (delError)
    log.error('Could not delete app version')
  // We should not care too much, most is in r2 anyways :/
  // program.error('')

  const { error: dbError } = await supabase
    .from('apps')
    .delete()
    .eq('app_id', appId)
    // .eq('user_id', userId)

  if (dbError) {
    log.error('Could not delete app')
    if (shouldExit)
      program.error('')
    throw new Error(`Could not delete app: ${formatError(dbError)}`)
  }
  const orgId = await getOrganizationId(supabase, appId)
  await sendEvent(options.apikey, {
    channel: 'app',
    event: 'App Deleted',
    icon: '🗑️',
    user_id: orgId,
    tags: {
      'app-id': appId,
    },
    notify: false,
  }).catch()
  log.success(`App deleted in Capgo`)
  if (shouldExit) {
    outro('Done ✅')
    exit()
  }
  return true
}
