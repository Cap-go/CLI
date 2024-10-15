import type { Options } from '../api/app'
import { intro, outro } from '@clack/prompts'
import { createSupabaseClient, findSavedKey, verifyUser } from '../utils'

export async function getUserId(options: Options) {
  intro(`Getting user id`)
  options.apikey = options.apikey || findSavedKey()
  const supabase = await createSupabaseClient(options.apikey)
  const userId = await verifyUser(supabase, options.apikey, ['read', 'all', 'write'])
  outro(`Done ✅: ${userId}`)
}
