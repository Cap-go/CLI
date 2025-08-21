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

export async function setOrganization(orgId: string, options: OptionsOrganization) {
  intro(`Updating organization`)

  await checkAlerts()
  options.apikey = options.apikey || findSavedKey()

  if (!options.apikey) {
    log.error('Missing API key, you need to provide an API key to update an organization')
    program.error('')
  }

  if (!orgId) {
    log.error('Missing argument, you need to provide an organization ID')
    program.error('')
  }

  const supabase = await createSupabaseClient(options.apikey, options.supaHost, options.supaAnon)
  await verifyUser(supabase, options.apikey, ['write', 'all'])

  // Get current organization data
  const { data: orgData, error: orgError } = await supabase
    .from('orgs')
    .select('name, management_email, created_by')
    .eq('id', orgId)
    .single()

  if (orgError || !orgData) {
    log.error(`Cannot get organization details ${formatError(orgError)}`)
    program.error('')
  }

  let { name, email } = options
  if (!name) {
    const nameInput = await text({
      message: 'New organization name:',
      placeholder: orgData.name || 'My Organization',
    })

    if (isCancel(nameInput)) {
      log.error('Canceled updating organization')
      program.error('')
    }
    name = nameInput as string
  }

  if (!email) {
    const emailInput = await text({
      message: 'Management email:',
      placeholder: orgData.management_email || 'admin@example.com',
    })

    if (isCancel(emailInput)) {
      log.error('Canceled updating organization')
      program.error('')
    }
    email = emailInput as string
  }

  if (!name || !email) {
    log.error('Missing arguments, you need to provide an organization name and management email')
    program.error('')
  }

  log.info(`Updating organization "${orgId}"`)

  const { error: dbError } = await supabase
    .from('orgs')
    .update({
      name,
      management_email: email,
    })
    .eq('id', orgId)

  if (dbError) {
    log.error(`Could not update organization ${formatError(dbError)}`)
    program.error('')
  }

  await sendEvent(options.apikey, {
    channel: 'organization',
    event: 'Organization Updated',
    icon: '✏️',
    user_id: orgId,
    tags: {
      'org-name': name,
    },
    notify: false,
  }).catch()

  log.success(`Organization updated`)
  outro('Done ✅')
  exit()
}
