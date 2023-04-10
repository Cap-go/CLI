import { program } from 'commander';
import * as p from '@clack/prompts';
import QRCode from 'qrcode';
import { tunnel } from "cloudflared";
import { Options } from '../api/app';
import { createSupabaseClient, findSavedKey, useLogSnag, verifyUser } from '../utils';
import { checkLatest } from '../api/update';

export const watch = async (port: string, options: Options, shouldExit = true) => {

  options.apikey = options.apikey || findSavedKey()
  if (!options.apikey) {
    if (shouldExit) {
      program.error("Missing API key, you need to provide a API key to upload your bundle");
    }
    return false
  }
  await checkLatest();
  p.intro(`Capgo tunnel init`);

  // write in file .capgo the apikey in home directory
  try {
    const snag = useLogSnag()

    const supabase = createSupabaseClient(options.apikey)
    const userId = await verifyUser(supabase, options.apikey, ['write', 'all', 'upload']);
    await snag.publish({
      channel: 'app',
      event: 'live reload',
      icon: '🔄',
      tags: {
        'user-id': userId,
      },
      notify: false,
    }).catch()
    const { url, connections, stop } = tunnel({ "--url": `localhost:${port}` });

    const link = await url;
    await Promise.all(connections);

    p.log.info(`Tunnel ${link} connected to localhost:${port}`);
    const qrUrl = await QRCode.toString(link, { type: 'terminal', small: true });
    p.log.info(qrUrl);
    await p.confirm({ message: `When done say yes to close tunnel` });
    await stop();
    p.log.info(`Tunnel closed`);
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

export const watchApp = async (apikey: string, options: Options) => {
  watch(apikey, options, true)
}