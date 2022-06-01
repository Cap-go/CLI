import { program } from 'commander';
import fs from 'fs'
import os from 'os'

interface Options {
  local: boolean;
}
export const login = async (apikey: string, options: Options) => {
  // write in file .capgo the apikey in home directory
  const { local } = options;

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
  console.log(`login saved into .capgo file in ${local ? 'local' : 'home'} directory`);
}
