import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { intro, log, outro } from '@clack/prompts'
import { checkAlerts } from './api/update'
import { createSupabaseClient, sendEvent, verifyUser } from './utils'

interface Options {
  local: boolean
  supaHost?: string
  supaAnon?: string
}

export function doLoginExists() {
  const userHomeDir = homedir()
  return existsSync(`${userHomeDir}/.capgo`) || existsSync('.capgo')
}

export async function loginInternal(apikey: string, options: Options, silent = false) {
  if (!silent)
    intro(`Login to Capgo`)

  if (!apikey) {
    if (!silent)
      log.error('Missing API key, you need to provide an API key to upload your bundle')
    throw new Error('Missing API key')
  }

  await checkAlerts()
  // write in file .capgo the apikey in home directory
  const { local } = options

  if (local) {
    if (!existsSync('.git')) {
      if (!silent)
        log.error('To use local you should be in a git repository')
      throw new Error('Not in a git repository')
    }
    writeFileSync('.capgo', `${apikey}\n`)
    appendFileSync('.gitignore', '.capgo\n')
  }
  else {
    const userHomeDir = homedir()
    writeFileSync(`${userHomeDir}/.capgo`, `${apikey}\n`)
  }

  const supabase = await createSupabaseClient(apikey, options.supaHost, options.supaAnon)
  const userId = await verifyUser(supabase, apikey, ['write', 'all', 'upload'])
  await sendEvent(apikey, {
    channel: 'user-login',
    event: 'User CLI login',
    icon: '✅',
    user_id: userId,
    notify: false,
  }).catch()

  if (!silent) {
    log.success(`login saved into .capgo file in ${local ? 'local' : 'home'} directory`)
    outro('Done ✅')
  }
}

export async function loginCommand(apikey: string, options: Options) {
  await loginInternal(apikey, options, false)
}
