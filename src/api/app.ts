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

export async function checkAppExistsAndHasPermissionOrgErr(
  supabase: SupabaseClient<Database>,
  apikey: string,
  appid: string,
  requiredPermission: OrganizationPerm,
  silent = false,
) {
  const pm = getPMAndCommand()
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
}

export const newIconPath = 'assets/icon.png'
