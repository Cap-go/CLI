import { exit } from 'node:process'
import type { SupabaseClient } from '@supabase/supabase-js'
import { program } from 'commander'
import { confirm as confirmC, intro, log, spinner } from '@clack/prompts'
import type { Database } from '../types/supabase.types'
import { formatError } from '../utils'

export async function checkVersionNotUsedInDeviceOverride(supabase: SupabaseClient<Database>, appid: string, versionData: Database['public']['Tables']['app_versions']['Row']) {
  const { data: deviceFound, error: errorDevice } = await supabase
    .from('devices_override')
    .select()
    .eq('app_id', appid)
    .eq('version', versionData.id)
  if (errorDevice) {
    log.error(`Cannot check Device override ${appid}@${versionData.name}`)
    program.error('')
  }
  if (deviceFound && deviceFound.length > 0) {
    intro(`❌ Version ${appid}@${versionData.name} is used in ${deviceFound.length} device override`)
    if (await confirmC({ message: 'unlink it?' })) {
      // loop on all devices and set version to unknown
      for (const device of deviceFound) {
        const s = spinner()
        s.start(`Unlinking device ${device.device_id}`)
        const { error: errorDeviceDel } = await supabase
          .from('devices_override')
          .delete()
          .eq('device_id', device.device_id)
        if (errorDeviceDel) {
          s.stop(`Cannot unlink device ${device.device_id} ${formatError(errorDeviceDel)}`)
          exit(1)
        }
        s.stop(`✅ Device ${device.device_id} unlinked`)
      }
    }
    else {
      log.error(`Unlink it first`)
      program.error('')
    }
  }
}
