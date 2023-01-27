import { program } from 'commander';
import { existsSync, writeFileSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { createSupabaseClient, useLogSnag, verifyUser } from './utils';

interface Options {
  local: boolean;
}
export const login = async (apikey: string, options: Options) => {
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
    // snag.publish({
    //   channel: 'user-login',
    //   event: 'User CLI login',
    //   icon: '✅',
    //   tags: {
    //     'user-id': userId,
    //   },
    //   notify: false,
    // }).catch()
    console.log(`login saved into .capgo file in ${local ? 'local' : 'home'} directory`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
