import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { exit } from 'node:process'
import { intro, log, outro } from '@clack/prompts'
import { program } from 'commander'
import { checkAlerts } from './api/update'
import { createSupabaseClient, sendEvent, verifyUser } from './utils'

interface Options {
  local: boolean
  supaHost?: string
  supaAnon?: string
}
export async function doLoginExists() {
  const userHomeDir = homedir()
  return existsSync(`${userHomeDir}/.capgo`) || existsSync('.capgo')
}

export async function login(apikey: string, options: Options, shouldExit = true) {
  if (shouldExit)
    intro(`Login to Capgo`)

  if (!apikey) {
    if (shouldExit) {
      log.error('Missing API key, you need to provide a API key to upload your bundle')
      program.error('')
    }
    return false
  }
  await checkAlerts()
  // write in file .capgo the apikey in home directory
  try {
    const { local } = options

    if (local) {
      if (!existsSync('.git')) {
        log.error('To use local you should be in a git repository')
        program.error('')
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
    log.success(`login saved into .capgo file in ${local ? 'local' : 'home'} directory`)
  }
  catch {
    log.error(`Error while saving login`)
    exit(1)
  }
  if (shouldExit) {
    outro('Done ✅')
    exit()
  }
  return true
}

export async function loginCommand(apikey: string, options: Options) {
  login(apikey, options, true)
}
