import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { confirm as confirmC, intro, isCancel, log, outro, select } from '@clack/prompts'
import { program } from 'commander'
import { checkAlerts } from '../api/update'
import {
  createSupabaseClient,
  findSavedKey,
  formatError,
  sendEvent,
  verifyUser,
} from '../utils'

export async function deleteOrganization(orgId: string, options: OptionsBase) {
  intro(`Deleting organization`)

  await checkAlerts()
  options.apikey = options.apikey || findSavedKey()

  if (!options.apikey) {
    log.error('Missing API key, you need to provide an API key to delete an organization')
    program.error('')
  }

  if (!orgId) {
    log.error('Missing argument, you need to provide an organization ID')
    program.error('')
  }

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])

  // Check if user is the owner
  const { data: orgData, error: orgError } = await supabase
    .from('orgs')
    .select('created_by, name')
    .eq('id', orgId)
    .single()

  if (orgError || !orgData) {
    log.error(`Cannot get organization details ${formatError(orgError)}`)
    program.error('')
  }

  if (orgData.created_by !== userId) {
    log.warn('Deleting an organization is restricted to the organization owner')
    log.warn('You are not the owner of this organization')
    log.warn('It\'s strongly recommended that you do not continue!')

    const shouldContinue = await select({
      message: 'Do you want to continue?',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
    })

    if (isCancel(shouldContinue) || shouldContinue === 'no') {
      log.error('Canceled deleting the organization')
      program.error('')
    }
  }

  // Final confirmation
  const confirmDelete = await confirmC({
    message: `Are you sure you want to delete organization "${orgData.name}"? This action cannot be undone.`,
  })

  if (isCancel(confirmDelete) || !confirmDelete) {
    log.error('Canceled deleting the organization')
    program.error('')
  }

  log.info(`Deleting organization "${orgData.name}"`)

  // Delete organization (cascading deletes should handle related records)
  const { error: dbError } = await supabase
    .from('orgs')
    .delete()
    .eq('id', orgId)

  if (dbError) {
    log.error(`Could not delete organization ${formatError(dbError)}`)
    program.error('')
  }

  await sendEvent(options.apikey, {
    channel: 'organization',
    event: 'Organization Deleted',
    icon: '🗑️',
    user_id: orgId,
    tags: {
      'org-name': orgData.name,
    },
    notify: false,
  }).catch()

  log.success(`Organization "${orgData.name}" deleted from Capgo`)
  outro('Done ✅')
  exit()
}
