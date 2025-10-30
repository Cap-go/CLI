import type { OptionsBase } from '../utils'
import { intro, isCancel, log, outro, text } from '@clack/prompts'
import { checkAlerts } from '../api/update'
import {
  createSupabaseClient,
  findSavedKey,
  formatError,
  sendEvent,
  verifyUser,
} from '../utils'

interface OptionsOrganization extends OptionsBase {
  name?: string
  email?: string
}

export async function setOrganizationInternal(
  orgId: string,
  options: OptionsOrganization,
  silent = false,
) {
  if (!silent)
    intro('Updating organization')

  await checkAlerts()

  const enrichedOptions: OptionsOrganization = {
    ...options,
    apikey: options.apikey || findSavedKey(),
  }

  if (!enrichedOptions.apikey) {
    if (!silent)
      log.error('Missing API key, you need to provide an API key to update an organization')
    throw new Error('Missing API key')
  }

  if (!orgId) {
    if (!silent)
      log.error('Missing argument, you need to provide an organization ID')
    throw new Error('Missing organization id')
  }

  const supabase = await createSupabaseClient(
    enrichedOptions.apikey,
    enrichedOptions.supaHost,
    enrichedOptions.supaAnon,
  )
  await verifyUser(supabase, enrichedOptions.apikey, ['write', 'all'])

  const { data: orgData, error: orgError } = await supabase
    .from('orgs')
    .select('name, management_email, created_by')
    .eq('id', orgId)
    .single()

  if (orgError || !orgData) {
    if (!silent)
      log.error(`Cannot get organization details ${formatError(orgError)}`)
    throw new Error(`Cannot get organization details: ${formatError(orgError)}`)
  }

  let { name, email } = enrichedOptions

  if (!silent && !name) {
    const nameInput = await text({
      message: 'New organization name:',
      placeholder: orgData.name || 'My Organization',
    })

    if (isCancel(nameInput)) {
      log.error('Canceled updating organization')
      throw new Error('Organization update cancelled')
    }
    name = nameInput as string
  }

  if (!silent && !email) {
    const emailInput = await text({
      message: 'Management email:',
      placeholder: orgData.management_email || 'admin@example.com',
    })

    if (isCancel(emailInput)) {
      log.error('Canceled updating organization')
      throw new Error('Organization update cancelled')
    }
    email = emailInput as string
  }

  if (!name || !email) {
    if (!silent)
      log.error('Missing arguments, you need to provide an organization name and management email')
    throw new Error('Missing organization name or management email')
  }

  if (!silent)
    log.info(`Updating organization "${orgId}"`)

  const { error: dbError } = await supabase
    .from('orgs')
    .update({
      name,
      management_email: email,
    })
    .eq('id', orgId)

  if (dbError) {
    if (!silent)
      log.error(`Could not update organization ${formatError(dbError)}`)
    throw new Error(`Could not update organization: ${formatError(dbError)}`)
  }

  await sendEvent(enrichedOptions.apikey, {
    channel: 'organization',
    event: 'Organization Updated',
    icon: '✏️',
    user_id: orgId,
    tags: {
      'org-name': name,
    },
    notify: false,
  }).catch(() => {})

  if (!silent) {
    log.success('Organization updated')
    outro('Done ✅')
  }

  return { orgId, name, email }
}

export async function setOrganization(orgId: string, options: OptionsOrganization) {
  await setOrganizationInternal(orgId, options, false)
}
