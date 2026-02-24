import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase.types'
import { log } from '@clack/prompts'
import { getPMAndCommand, isAllowedAppOrg, OrganizationPerm, show2FADeniedError } from '../utils'

export async function checkAppExists(supabase: SupabaseClient<Database>, appid: string) {
  const { data: app } = await supabase
    .rpc('exist_app_v2', { appid })
    .single()
  return !!app
}

/**
 * Check multiple app IDs at once for batch validation (e.g., for suggestions)
 */
export async function checkAppIdsExist(supabase: SupabaseClient<Database>, appids: string[]) {
  const results = await Promise.all(
    appids.map(async (appid) => {
      const { data: app } = await supabase
        .rpc('exist_app_v2', { appid })
        .single()
      return { appid, exists: !!app }
    }),
  )
  return results
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
    if (silent) {
      throw new Error('2FA required for this organization')
    }
    show2FADeniedError()
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

export type { AppOptions as Options } from '../schemas/app'

export const newIconPath = 'assets/icon.png'
