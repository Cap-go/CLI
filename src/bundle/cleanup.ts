import { exit } from 'node:process'
import { program } from 'commander'
import semver from 'semver/preload'
import type { SupabaseClient } from '@supabase/supabase-js'
import { confirm as confirmC, intro, isCancel, log, outro } from '@clack/prompts'
import type { Database } from '../types/supabase.types'
import type { OptionsBase } from '../utils'
import { OrganizationPerm, createSupabaseClient, findSavedKey, getConfig, getHumanDate, verifyUser } from '../utils'
import { deleteSpecificVersion, displayBundles, getActiveAppVersions, getChannelsVersion } from '../api/versions'
import { checkAppExistsAndHasPermissionOrgErr } from '../api/app'
import { checkLatest } from '../api/update'

interface Options extends OptionsBase {
  version: string
  bundle: string
  keep: number
  force: boolean
}

async function removeVersions(toRemove: Database['public']['Tables']['app_versions']['Row'][], supabase: SupabaseClient<Database>, appid: string) {
  // call deleteSpecificVersion one by one from toRemove sync
  for await (const row of toRemove) {
    log.warn(`Removing ${row.name} created on ${(getHumanDate(row.created_at))}`)
    await deleteSpecificVersion(supabase, appid, row.name)
  }
}

function getRemovableVersionsInSemverRange(data: Database['public']['Tables']['app_versions']['Row'][], bundle: string, nextMajor: string) {
  const toRemove: Database['public']['Tables']['app_versions']['Row'][] = []

  data?.forEach((row) => {
    if (semver.gte(row.name, bundle) && semver.lt(row.name, `${nextMajor}`))
      toRemove.push(row)
  })
  return toRemove
}

export async function cleanupBundle(appId: string, options: Options) {
  intro(`Cleanup versions in Capgo`)
  await checkLatest()
  options.apikey = options.apikey || findSavedKey()
  const { bundle, keep = 4 } = options
  const force = options.force || false

  const extConfig = await getConfig()
  appId = appId || extConfig?.config?.appId
  if (!options.apikey) {
    log.error('Missing API key, you need to provide an API key to delete your app')
    program.error('')
  }
  if (!appId) {
    log.error('Missing argument, you need to provide a appid, or be in a capacitor project')
    program.error('')
  }
  const supabase = await createSupabaseClient(options.apikey)

  await verifyUser(supabase, options.apikey, ['write', 'all'])

  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionOrgErr(supabase, options.apikey, appId, OrganizationPerm.write)
  log.info(`Querying all available versions in Capgo`)

  // Get all active app versions we might possibly be able to cleanup
  let allVersions: (Database['public']['Tables']['app_versions']['Row'] & { keep?: string })[] = await getActiveAppVersions(supabase, appId)

  const versionInUse = await getChannelsVersion(supabase, appId)

  log.info(`Total active versions in Capgo: ${allVersions?.length}`)
  if (allVersions?.length === 0) {
    log.error('No versions found, aborting cleanup')
    return
  }
  if (bundle) {
    const nextMajor = `${semver.inc(bundle, 'major')}`
    log.info(`Querying available versions in Capgo between ${bundle} and ${nextMajor}`)

    // Get all app versions that are in the given range
    allVersions = getRemovableVersionsInSemverRange(allVersions, bundle, nextMajor) as (Database['public']['Tables']['app_versions']['Row'] & { keep: string })[]

    log.info(`Active versions in Capgo between ${bundle} and ${nextMajor}: ${allVersions?.length}`)
  }

  // Slice to keep and remove

  const toRemove: (Database['public']['Tables']['app_versions']['Row'] & { keep?: string })[] = []
  // Slice to keep and remove
  let kept = 0
  allVersions.forEach((v) => {
    const isInUse = versionInUse.find(vi => vi === v.id)
    if (kept < keep || isInUse) {
      if (isInUse)
        v.keep = '✅ (Linked to channel)'
      else
        v.keep = '✅'

      kept += 1
    }
    else {
      v.keep = '❌'
      toRemove.push(v)
    }
  })

  if (toRemove.length === 0) {
    log.warn('Nothing to be removed, aborting removal...')
    return
  }
  displayBundles(allVersions)
  // Check user wants to clean that all up
  if (!force) {
    const doDelete = await confirmC({ message: 'Do you want to continue removing the versions specified?' })
    if (isCancel(doDelete) || !doDelete) {
      log.warn('Not confirmed, aborting removal...')
      exit()
    }
  }

  // Yes, lets clean it up
  log.success('You have confirmed removal, removing versions now')
  await removeVersions(toRemove, supabase, appId)
  outro(`Done ✅`)
  exit()
}
