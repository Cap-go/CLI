import type { OptionsBase } from '../utils'
import { confirm, intro, isCancel, log, outro, text } from '@clack/prompts'
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
  enforce2fa?: boolean
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
    .select('name, management_email, created_by, enforcing_2fa')
    .eq('id', orgId)
    .single()

  if (orgError || !orgData) {
    if (!silent)
      log.error(`Cannot get organization details ${formatError(orgError)}`)
    throw new Error(`Cannot get organization details: ${formatError(orgError)}`)
  }

  let { name, email, enforce2fa } = enrichedOptions

  // Handle 2FA enforcement option
  if (enforce2fa !== undefined) {
    if (enforce2fa && !orgData.enforcing_2fa) {
      // User wants to enable 2FA enforcement - check members first
      const { data: membersData, error: membersError } = await supabase
        .rpc('check_org_members_2fa_enabled', { org_id: orgId })

      if (membersError) {
        if (!silent)
          log.error(`Cannot check organization members 2FA status: ${formatError(membersError)}`)
        throw new Error(`Cannot check organization members 2FA status: ${formatError(membersError)}`)
      }

      const membersWithout2FA = membersData?.filter((m: { has_2fa: boolean }) => !m.has_2fa) || []

      if (membersWithout2FA.length > 0) {
        if (!silent) {
          log.warn(`${membersWithout2FA.length} member${membersWithout2FA.length > 1 ? 's don\'t' : ' doesn\'t'} have 2FA enabled:`)
          for (const member of membersWithout2FA) {
            log.warn(`  - ${(member as { email: string }).email}`)
          }
          log.warn('These members will lose access to organization resources until they enable 2FA.')

          const shouldContinue = await confirm({
            message: 'Do you want to enable 2FA enforcement anyway?',
          })

          if (isCancel(shouldContinue) || !shouldContinue) {
            log.error('Canceled enabling 2FA enforcement')
            throw new Error('2FA enforcement cancelled')
          }
        }
      }
    }

    // Update 2FA enforcement setting
    const { error: twoFaError } = await supabase
      .from('orgs')
      .update({ enforcing_2fa: enforce2fa })
      .eq('id', orgId)

    if (twoFaError) {
      if (!silent)
        log.error(`Could not update 2FA enforcement: ${formatError(twoFaError)}`)
      throw new Error(`Could not update 2FA enforcement: ${formatError(twoFaError)}`)
    }

    if (!silent) {
      if (enforce2fa)
        log.success('2FA enforcement enabled')
      else
        log.success('2FA enforcement disabled')
    }

    // If only updating 2FA, we're done
    if (!name && !email) {
      if (!silent)
        outro('Done ✅')
      return { orgId, enforce2fa }
    }
  }

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
