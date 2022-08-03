import { program } from 'commander';
import fs from 'fs'
import os from 'os'
import { createSupabaseClient, formatError, useLogSnag } from './utils';

interface Options {
  local: boolean;
}
export const login = async (apikey: string, options: Options) => {
  // write in file .capgo the apikey in home directory
  const { local } = options;
  const snag = useLogSnag()

  if (local) {
    if (!fs.existsSync('.git')) {
      program.error('To use local you should be in a git repository');
    }
    fs.writeFileSync('.capgo', `${apikey}\n`);
    fs.appendFileSync('.gitignore', '.capgo\n');
  } else {
    const userHomeDir = os.homedir();
    fs.writeFileSync(`${userHomeDir}/.capgo`, `${apikey}\n`);
  }
  const supabase = createSupabaseClient(apikey)
  const { data: dataUser, error: userIdError } = await supabase
    .rpc<string>('get_user_id', { apikey })
  const userId = dataUser ? dataUser.toString() : '';
  if (!userId || userIdError) {
    program.error(`Cannot verify user ${formatError(userIdError)}`);
  }
  snag.publish({
    channel: 'user-login',
    event: 'User CLI login',
    icon: '✅',
    tags: {
      userId,
    },
    notify: false,
  })
  console.log(`login saved into .capgo file in ${local ? 'local' : 'home'} directory`);
}
