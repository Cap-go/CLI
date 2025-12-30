import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase.types'
import type { OptionsBase } from '../utils'
import { log } from '@clack/prompts'
import { getPMAndCommand, isAllowedAppOrg, OrganizationPerm } from '../utils'

export async function checkAppExists(supabase: SupabaseClient<Database>, appid: string) {
  const { data: app } = await supabase
    .rpc('exist_app_v2', { appid })
    .single()
  return !!app
}

export async function check2FAComplianceForApp(
  supabase: SupabaseClient<Database>,
  appid: string,
  silent = false,
): Promise<void> {
  // Use the new reject_access_due_to_2fa_for_app function
  // This handles getting the org, user identity (JWT or API key), and checking 2FA compliance
  const { data: shouldReject, error: rejectError } = await supabase
    .rpc('reject_access_due_to_2fa_for_app', { app_id: appid })

  if (rejectError) {
    if (!silent)
      log.error(`Cannot check 2FA compliance: ${rejectError.message}`)
    throw new Error(`Cannot check 2FA compliance: ${rejectError.message}`)
  }

  if (shouldReject) {
    if (!silent) {
      log.error(`\n🔐 Access Denied: Two-Factor Authentication Required`)
      log.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      log.error(`\nThis organization requires all members to have 2FA enabled.`)
      log.error(`\nTo regain access:`)
      log.error(`  1. Go to https://web.capgo.app/settings/account`)
      log.error(`  2. Enable Two-Factor Authentication on your account`)
      log.error(`  3. Try your command again`)
      log.error(`\nFor more information, visit: https://capgo.app/docs/webapp/2fa-enforcement/\n`)
    }
    throw new Error('2FA required for this organization')
  }
}

export async function checkAppExistsAndHasPermissionOrgErr(
  supabase: SupabaseClient<Database>,
  apikey: string,
  appid: string,
  requiredPermission: OrganizationPerm,
  silent = false,
  skip2FACheck = false,
) {
  const pm = getPMAndCommand()

  // Check 2FA compliance first (unless already checked earlier)
  if (!skip2FACheck)
    await check2FAComplianceForApp(supabase, appid, silent)

  const permissions = await isAllowedAppOrg(supabase, apikey, appid)
  if (!permissions.okay) {
    switch (permissions.error) {
      case 'INVALID_APIKEY': {
        const msg = 'Invalid apikey, such apikey does not exists!'
        if (!silent)
          log.error(msg)
        throw new Error(msg)
      }
      case 'NO_APP': {
        const msg = `App ${appid} does not exist, run first \`${pm.runner} @capgo/cli app add ${appid}\` to create it`
        if (!silent)
          log.error(msg)
        throw new Error(msg)
      }
      case 'NO_ORG': {
        const msg = 'Could not find organization, please contact support to resolve this!'
        if (!silent)
          log.error(msg)
        throw new Error(msg)
      }
    }
  }

  const remotePermNumber = permissions.data as number
  const requiredPermNumber = requiredPermission as number

  if (requiredPermNumber > remotePermNumber) {
    const msg = `Insuficcent permissions for app ${appid}. Current permission: ${OrganizationPerm[permissions.data]}, required for this action: ${OrganizationPerm[requiredPermission]}.`
    if (!silent)
      log.error(msg)
    throw new Error(msg)
  }

  return permissions.data
}

export interface Options extends OptionsBase {
  name?: string
  icon?: string
  retention?: number
  exposeMetadata?: boolean
}

export const newIconPath = 'assets/icon.png'
