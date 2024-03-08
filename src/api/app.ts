import type { SupabaseClient } from '@supabase/supabase-js'
import * as p from '@clack/prompts'
import { program } from 'commander'
import type { Database } from '../types/supabase.types'
import type { OptionsBase } from '../utils'
import { OrganizationPerm, isAllowedApp, isAllowedAppOrg } from '../utils'

export async function checkAppExists(supabase: SupabaseClient<Database>, appid: string) {
  const { data: app } = await supabase
    .rpc('exist_app_v2', { appid })
    .single()
  return !!app
}

export async function checkAppExistsAndHasPermissionErr(supabase: SupabaseClient<Database>, apikey: string, appid: string, shouldExist = true) {
  const appExist = await checkAppExists(supabase, appid)
  const perm = await isAllowedApp(supabase, apikey, appid)

  if (appExist && !shouldExist) {
    p.log.error(`App ${appid} already exist`)
    program.error('')
  }
  if (!appExist && shouldExist) {
    p.log.error(`App ${appid} does not exist`)
    program.error('')
  }
  if (appExist && !perm) {
    p.log.error(`App ${appid} exist and you don't have permission to access it`)
    if (appid === 'io.ionic.starter')
      p.log.info('Modify your appid in your capacitor.config.json file to something unique, this is a default appid for ionic starter app')

    program.error('')
  }
}

export async function checkAppExistsAndHasPermissionOrgErr(supabase: SupabaseClient<Database>, apikey: string, appid: string, requiredPermission: OrganizationPerm) {
  const permissions = await isAllowedAppOrg(supabase, apikey, appid)
  if (!permissions.okay) {
    switch (permissions.error) {
      case 'INVALID_APIKEY': {
        p.log.error('Invalid apikey, such apikey does not exists!')
        program.error('')
        break
      }
      case 'NO_APP': {
        p.log.error(`App ${appid} does not exist`)
        program.error('')
        break
      }
      case 'NO_ORG': {
        p.log.error('Could not find organization, please contact support to resolve this!')
        program.error('')
        break
      }
    }
  }

  const remotePermNumber = permissions.data as number
  const requiredPermNumber = requiredPermission as number

  if (requiredPermNumber > remotePermNumber) {
    p.log.error(`Insuficcent permissions for app ${appid}. Current permission: ${OrganizationPerm[permissions.data]}, required for this action: ${OrganizationPerm[requiredPermission]}.`)
    program.error('')
  }

  return permissions.data
}

export interface Options extends OptionsBase {
  name?: string
  icon?: string
  retention?: number
}

export const newIconPath = 'assets/icon.png'
