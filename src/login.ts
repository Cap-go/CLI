import { program } from 'commander';
import { existsSync, writeFileSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { createSupabaseClient, useLogSnag, verifyUser } from './utils';
import { checkLatest } from './api/update';

interface Options {
  local: boolean;
}

export const login = async (apikey: string, options: Options, shouldExit = true) => {
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
        program.error('To use local you should be in a git repository');
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
    console.log(`login saved into .capgo file in ${local ? 'local' : 'home'} directory`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
  if (shouldExit) {
    console.log(`Done ✅`);
    process.exit()
  }
  return true
}

export const loginCommand = async (apikey: string, options: Options) => {
  login(apikey, options, true)
}