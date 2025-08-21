import type { OptionsBase } from '../utils'
import { exit } from 'node:process'
import { intro, isCancel, log, outro, text } from '@clack/prompts'
import { program } from 'commander'
import { checkAlerts } from '../api/update'
import {
  createSupabaseClient,
  findSavedKey,
  formatError,
  sendEvent,
  verifyUser,
} from '../utils'

interface OptionsOrganization extends OptionsBase {
  name?: string
  email?: string
}

export async function addOrganization(options: OptionsOrganization) {
  intro(`Adding organization`)

  await checkAlerts()
  options.apikey = options.apikey || findSavedKey()

  if (!options.apikey) {
    log.error('Missing API key, you need to provide an API key to add an organization')
    program.error('')
  }

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
  const userId = await verifyUser(supabase, options.apikey, ['write', 'all'])

  let { name, email } = options
  if (!name) {
    const nameInput = await text({
      message: 'Organization name:',
      placeholder: 'My Organization',
    })

    if (isCancel(nameInput)) {
      log.error('Canceled adding organization')
      program.error('')
    }
    name = nameInput as string
  }

  if (!email) {
    const emailInput = await text({
      message: 'Management email:',
      placeholder: 'admin@example.com',
    })

    if (isCancel(emailInput)) {
      log.error('Canceled adding organization')
      program.error('')
    }
    email = emailInput as string
  }

  if (!name || !email) {
    log.error('Missing arguments, you need to provide an organization name and management email')
    program.error('')
  }

  log.info(`Adding organization "${name}" to Capgo`)

  const { data: orgData, error: dbError } = await supabase
    .from('orgs')
    .insert({
      name,
      management_email: email,
      created_by: userId,
    })
    .select()
    .single()

  if (dbError) {
    log.error(`Could not add organization ${formatError(dbError)}`)
    program.error('')
  }

  await sendEvent(options.apikey, {
    channel: 'organization',
    event: 'Organization Created',
    icon: '🏢',
    user_id: orgData.id,
    tags: {
      'org-name': name,
    },
    notify: false,
  }).catch()

  log.success(`Organization "${name}" added to Capgo`)
  outro('Done ✅')
  exit()
}
