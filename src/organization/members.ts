import type { OptionsBase } from '../utils'
import { intro, log, outro } from '@clack/prompts'
import { Table } from '@sauber/table'
import { checkAlerts } from '../api/update'
import {
  createSupabaseClient,
  findSavedKey,
  formatError,
  verifyUser,
} from '../utils'

interface MemberInfo {
  uid: string
  email: string
  role: string
  is_tmp: boolean
  has_2fa: boolean
}

function displayMembers(data: MemberInfo[], orgName: string, silent: boolean) {
  if (silent)
    return

  if (!data.length) {
    log.error('No members found')
    return
  }

  const t = new Table()
  t.headers = ['Email', 'Role', 'Status', '2FA Enabled']
  t.rows = []

  for (const row of data) {
    const status = row.is_tmp ? 'Invited' : 'Active'
    const has2FA = row.has_2fa ? '✓ Yes' : '✗ No'

    t.rows.push([
      row.email,
      row.role,
      status,
      has2FA,
    ])
  }

  log.success(`Members of "${orgName}"`)
  log.success(t.toString())
}

export async function listMembersInternal(orgId: string, options: OptionsBase, silent = false) {
  if (!silent)
    intro('List organization members')

  await checkAlerts()

  const enrichedOptions: OptionsBase = {
    ...options,
    apikey: options.apikey || findSavedKey(),
  }

  if (!enrichedOptions.apikey) {
    if (!silent)
      log.error('Missing API key, you need to provide an API key to list members')
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
  await verifyUser(supabase, enrichedOptions.apikey, ['read', 'write', 'all'])

  // Get organization name
  const { data: orgData, error: orgError } = await supabase
    .from('orgs')
    .select('name, enforcing_2fa')
    .eq('id', orgId)
    .single()

  if (orgError || !orgData) {
    if (!silent)
      log.error(`Cannot get organization details: ${formatError(orgError)}`)
    throw new Error(`Cannot get organization details: ${formatError(orgError)}`)
  }

  if (!silent)
    log.info(`Getting members of "${orgData.name}" from Capgo`)

  // Get members
  const { data: members, error: membersError } = await supabase
    .rpc('get_org_members', { guild_id: orgId })

  if (membersError) {
    if (!silent)
      log.error(`Cannot get organization members: ${formatError(membersError)}`)
    throw new Error(`Cannot get organization members: ${formatError(membersError)}`)
  }

  // Get 2FA status for all members (only super_admins can call this)
  const { data: membersStatus, error: statusError } = await supabase
    .rpc('check_org_members_2fa_enabled', { org_id: orgId })

  if (statusError) {
    if (!silent) {
      if (statusError.message?.includes('NO_RIGHTS')) {
        log.warn('You need super_admin rights to view 2FA status of members')
      }
      else {
        log.error(`Cannot get 2FA status: ${formatError(statusError)}`)
      }
    }
    // Continue without 2FA status
  }

  // Merge member info with 2FA status
  const memberInfoList: MemberInfo[] = (members || []).map((m) => {
    const status = membersStatus?.find(s => s.user_id === m.uid)
    return {
      uid: m.uid,
      email: m.email,
      role: m.role,
      is_tmp: m.is_tmp,
      has_2fa: status?.['2fa_enabled'] ?? false,
    }
  })

  if (!silent) {
    log.info(`Members found: ${memberInfoList.length}`)

    if (orgData.enforcing_2fa) {
      log.info(`🔐 2FA enforcement is ENABLED for this organization`)
    }
    else {
      log.info(`2FA enforcement is disabled for this organization`)
    }

    displayMembers(memberInfoList, orgData.name, silent)
    outro('Done ✅')
  }

  return memberInfoList
}

export async function listMembers(orgId: string, options: OptionsBase) {
  await listMembersInternal(orgId, options, false)
}

