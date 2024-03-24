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
    p.log.error(`App ${appid} already exists`)
    program.error('')
  }
  if (!appExist && shouldExist) {
    p.log.error(`App ${appid} does not exist`)
    program.error('')
  }
  if (appExist && !perm) {
    p.log.error(`App ${appid} exists, but you don't have permission to access it`)
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
        p.log.error('Invalid API key, such API key does not exist!')
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
    p.log.error(`Insufficient permissions for app ${appid}. Current permission: ${OrganizationPerm[permissions.data]}, required for this action: ${OrganizationPerm[requiredPermission]}.`)
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

// Auto-delete mechanism for failed upload tasks
export async function autoDeleteFailedUploads(supabase: SupabaseClient<Database>, userId: string) {
  // Check if the user has permission to trigger auto-deletion
  const userHasPermission = await checkUserPermissionForAutoDelete(userId)
  if (!userHasPermission) {
    console.error('User does not have permission to trigger auto-deletion')
    return
  }

  // Retrieve failed upload tasks
  const failedUploads = await getFailedUploadTasks(supabase)
  for (const upload of failedUploads) {
    // Ensure that the version can be safely deleted
    const versionCanBeDeleted = await checkVersionDeletionEligibility(upload.versionId)
    if (versionCanBeDeleted) {
      // Delete the version
      await deleteVersion(supabase, upload.versionId)
      console.log(`Failed upload with version ID ${upload.versionId} deleted`)
    } else {
      console.error(`Version with ID ${upload.versionId} cannot be deleted`)
    }
  }
}

// Check if the user has permission to trigger auto-deletion
async function checkUserPermissionForAutoDelete(supabase: SupabaseClient<Database>, userId: string) {
  try {
    // Retrieve the user's role and permissions from the database
    const { data: user } = await supabase
      .from('users')
      .select('role', 'permissions')
      .eq('id', userId)
      .single()

    if (!user) {
      console.error('User not found')
      return false
    }

    // Check if the user's role or permissions allow them to trigger auto-deletion
    // This is just an example, you should customize it based on your actual authorization logic
    if (user.role === 'admin' || user.permissions?.includes('auto-delete')) {
      return true
    } else {
      return false
    }
  } catch (error) {
    console.error('Error checking user permissions:', error.message)
    return false
  }
}

// Retrieve failed upload tasks from the database
async function getFailedUploadTasks(supabase: SupabaseClient<Database>) {
  const { data: failedUploads, error } = await supabase
    .from('upload_tasks')
    .select('*')
    .eq('status', 'failed')
    .catch((error) => {
      console.error('Error retrieving failed upload tasks:', error.message)
      return { data: [], error }
    })

  if (error) {
    console.error('Error retrieving failed upload tasks:', error.message)
    return []
  }

  return failedUploads
}

// Check if the version can be safely deleted
async function checkVersionDeletionEligibility(supabase: SupabaseClient<Database>, versionId: string) {
  try {
    // Check if the version exists and is in a failed state
    const { data: version } = await supabase
      .from('versions')
      .select('status')
      .eq('id', versionId)
      .single()

    if (!version) {
      console.error(`Version with ID ${versionId} not found`)
      return false
    }

    // Check if the version is in a failed state
    if (version.status !== 'failed') {
      console.error(`Version with ID ${versionId} is not in a failed state`)
      return false
    }

    // Additional checks can be added here based on your requirements

    // If all checks pass, return true indicating that the version can be deleted
    return true
  } catch (error) {
    console.error(`Error checking version deletion eligibility for version with ID ${versionId}:`, error.message)
    return false
  }
}

// Delete a version by its ID
async function deleteVersion(supabase: SupabaseClient<Database>, versionId: string) {
  await supabase
    .from('versions')
    .delete()
    .eq('id', versionId)
    .catch((error) => {
      console.error(`Error deleting version with ID ${versionId}:`, error.message)
    })
}
