import type { Options } from '../api/app'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { createSupabaseClient, findSavedKey, formatError, verifyUser } from '../utils'

export async function getUserId(options: Options) {
  intro(`Getting user id`)
  options.apikey = options.apikey || findSavedKey()
  try {
    const supabase = await createSupabaseClient(options.apikey)
    const userId = await verifyUser(supabase, options.apikey, ['read', 'all', 'write'])
    outro(`Done ✅: ${userId}`)
  }
  catch (err) {
    log.error(`Error getting user id ${formatError(err)}`)
    program.error('')
  }
}
