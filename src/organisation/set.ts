import type { OptionsBase } from '../utils'
import { confirm as confirmC, intro, isCancel, log, outro, text } from '@clack/prompts'
import { Table } from '@sauber/table'
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

  // Handle 2FA enforcement changes
  if (enforce2fa !== undefined) {
    if (!silent) {
      if (enforce2fa && !orgData.enforcing_2fa) {
        // Enabling 2FA enforcement - check members and warn
        log.info('Checking organization members 2FA status...')

        const { data: membersStatus, error: membersError } = await supabase
          .rpc('check_org_members_2fa_enabled', { org_id: orgId })

        if (membersError) {
          log.error(`Cannot check members 2FA status: ${formatError(membersError)}`)
          throw new Error('Cannot check members 2FA status')
        }

        // Also check if the current user has 2FA enabled
        const { data: userHas2FA, error: user2FAError } = await supabase
          .rpc('has_2fa_enabled')

        if (user2FAError) {
          log.error(`Cannot check your 2FA status: ${formatError(user2FAError)}`)
          throw new Error('Cannot check your 2FA status')
        }

        // Get current user ID to exclude from member count
        const { data: currentUserId } = await supabase.rpc('get_identity', { keymode: ['read', 'upload', 'write', 'all'] })

        // Filter out members without 2FA, excluding the current user (they're warned separately)
        const membersWithout2FA = (membersStatus?.filter(m => !m['2fa_enabled'] && m.user_id !== currentUserId) || [])

        if (membersWithout2FA.length > 0 || !userHas2FA) {
          log.warn('⚠️  Warning: Enabling 2FA enforcement will affect access')
          log.message('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

          if (!userHas2FA) {
            log.warn('🔐 YOU do not have 2FA enabled! By enabling 2FA enforcement, you will LOSE ACCESS to this organization until you enable 2FA on your account.')
          }

          if (membersWithout2FA.length > 0) {
            // Get member details
            const { data: members } = await supabase
              .rpc('get_org_members', { guild_id: orgId })

            const emails: string[] = []
            for (const member of membersWithout2FA) {
              const memberInfo = members?.find(m => m.uid === member.user_id)
              emails.push(memberInfo?.email || member.user_id)
            }

            const memberWord = membersWithout2FA.length === 1 ? 'member does' : 'members do'
            const thisThese = membersWithout2FA.length === 1 ? 'This member will' : 'These members will'
            log.warn(`${membersWithout2FA.length} ${memberWord} not have 2FA enabled: ${emails.join(', ')}`)
            log.warn(`${thisThese} lose access until they enable 2FA.`)
          }

          const shouldContinue = await confirmC({
            message: 'Are you sure you want to enable 2FA enforcement?',
          })

          if (isCancel(shouldContinue) || !shouldContinue) {
            log.error('Canceled enabling 2FA enforcement')
            throw new Error('2FA enforcement cancelled')
          }
        }

        log.info('Enabling 2FA enforcement for organization...')
      }
      else if (!enforce2fa && orgData.enforcing_2fa) {
        log.info('Disabling 2FA enforcement for organization...')
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
      if (enforce2fa) {
        log.success('✓ 2FA enforcement enabled for this organization')
      }
      else {
        log.success('✓ 2FA enforcement disabled for this organization')
      }
    }

    // If only changing 2FA enforcement, we can skip the name/email update
    if (name === undefined && email === undefined) {
      await sendEvent(enrichedOptions.apikey, {
        channel: 'organization',
        event: enforce2fa ? 'Organization 2FA Enabled' : 'Organization 2FA Disabled',
        icon: '🔐',
        user_id: orgId,
        tags: {
          'org-name': orgData.name,
          'enforce-2fa': enforce2fa.toString(),
        },
        notify: false,
      }).catch(() => {})

      if (!silent) {
        outro('Done ✅')
      }

      return { orgId, name: orgData.name, email: orgData.management_email, enforce2fa }
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
