import { SupabaseClient } from '@supabase/supabase-js';
import * as p from '@clack/prompts';
import { program } from 'commander';
import { Database } from '../types/supabase.types';
import { isAllowedApp, isAllowedAppOrg, OptionsBase, OrganizationPerm } from '../utils';

export const checkAppExists = async (supabase: SupabaseClient<Database>, appid: string) => {
  const { data: app } = await supabase
    .rpc('exist_app_v2', { appid })
    .single();
  return !!app;
}

export const checkAppExistsAndHasPermissionErr = async (supabase: SupabaseClient<Database>, apikey: string, appid: string,
  shouldExist = true) => {
  const res = await checkAppExists(supabase, appid);
  const perm = await isAllowedApp(supabase, apikey, appid);

  if (res && !shouldExist) {
    p.log.error(`App ${appid} already exist`);
    program.error('');
  }
  if (!res && shouldExist) {
    p.log.error(`App ${appid} does not exist`);
    program.error('');
  }
  if (res && !perm) {
    p.log.error(`App ${appid} exist and you don't have permission to access it`);
    program.error('');
  }
}

export const checkAppExistsAndHasPermissionOrgErr = async (
  supabase: SupabaseClient<Database>, 
  apikey: string, 
  appid: string, 
  requiredPermission: OrganizationPerm
) => {
  const permissions = await isAllowedAppOrg(supabase, apikey, appid)
  if (!permissions.okay) {
    // eslint-disable-next-line default-case
    switch (permissions.error) {
      case 'INVALID_APIKEY': {
        p.log.error('Invalid apikey, such apikey does not exists!')
        program.error('');
        break
      }
      case 'NO_APP': {
        p.log.error(`App ${appid} does not exist`);
        program.error('');
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
    // eslint-disable-next-line max-len
    p.log.error(`Insuficcent permissions for app ${appid}. Current permission: ${OrganizationPerm[permissions.data]}, required for this action: ${OrganizationPerm[requiredPermission]}.`)
    program.error('')
  }

  return permissions.data
}

export interface Options extends OptionsBase {
  name?: string;
  icon?: string;
  retention?: number;
}

export const newIconPath = "assets/icon.png"
