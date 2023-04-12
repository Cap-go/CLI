import { program } from 'commander';
import { existsSync, writeFileSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import * as p from '@clack/prompts';
import { createSupabaseClient, useLogSnag, verifyUser } from './utils';
import { checkLatest } from './api/update';

interface Options {
  local: boolean;
}

export const login = async (apikey: string, options: Options, shouldExit = true) => {

  if (shouldExit) {
    p.intro(`Login to Capgo`);
  }
  if (!apikey) {
    if (shouldExit) {
      program.error("Missing API key, you need to provide a API key to upload your bundle");
    }
    return false
  }
  await checkLatest();
  // write in file .capgo the apikey in home directory
  try {
    const { local } = options;
    const snag = useLogSnag()

    if (local) {
      if (!existsSync('.git')) {
        p.log.error('To use local you should be in a git repository');
        program.error('');
      }
      writeFileSync('.capgo', `${apikey}\n`);
      appendFileSync('.gitignore', '.capgo\n');
    } else {
      const userHomeDir = homedir();
      writeFileSync(`${userHomeDir}/.capgo`, `${apikey}\n`);
    }
    const supabase = createSupabaseClient(apikey)
    const userId = await verifyUser(supabase, apikey, ['write', 'all', 'upload']);
    await snag.publish({
      channel: 'user-login',
      event: 'User CLI login',
      icon: '✅',
      tags: {
        'user-id': userId,
      },
      notify: false,
    }).catch()
    p.log.success(`login saved into .capgo file in ${local ? 'local' : 'home'} directory`);
  } catch (e) {
    p.log.error(`Error while saving login`);
    process.exit(1);
  }
  if (shouldExit) {
    p.outro('Done ✅');
    process.exit()
  }
  return true
}

export const loginCommand = async (apikey: string, options: Options) => {
  login(apikey, options, true)
}