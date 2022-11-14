import { program } from 'commander';
import semver from 'semver/preload';
import promptSync from 'prompt-sync';
import { getConfig, createSupabaseClient, findSavedKey, verifyUser } from './utils';
import { definitions } from './types_supabase'
import { deleteSpecificVersion } from './deleteSpecificVersion';

interface Options {
  apikey: string;
  version: string;
  bundle: string;
}

type AppVersion = {
  id: number;
  created_at?: string | undefined;
  app_id: string;
  name: string;
  bucket_id?: string | undefined;
  user_id: string;
  updated_at?: string | undefined;
  deleted: boolean;
  external_url?: string | undefined;
  checksum?: string | undefined;
};

const prompt = promptSync();

export const cleanupApp = async (appid: string, options: Options) => {
  const apikey = options.apikey || findSavedKey()
  const { bundle } = options;

  const config = await getConfig();

  appid = appid || config?.app?.appId
  if (!apikey) {
    program.error('Missing API key, you need to provide an API key to delete your app');
  }
  if (!bundle) {
    program.error('Missing bundle version, provide a major version to cleanup');
  }
  if (!appid) {
    program.error('Missing argument, you need to provide a appid, or be in a capacitor project');
  }
  const nextMajor = `${semver.inc(bundle,'major')}`;

  console.log(`Querying available versions in Capgo between ${bundle} and ${nextMajor}`);

  const supabase = createSupabaseClient(apikey)

  const userId = await verifyUser(supabase, apikey);

  const { data: app, error: dbError0 } = await supabase
    .rpc<string>('exist_app', { appid, apikey })
  if (!app || dbError0) {
    program.error('No permission for this app')
  }

  const { data, error: vError } = await supabase
    .from<definitions['app_versions']>('app_versions')
    .select()
    .eq('app_id', appid)
    .eq('user_id', userId)
    .eq('deleted', false)

  if (vError) {
    program.error(`App ${appid} not found in database ${vError} `)
  }

  console.log(`Total active versions in Capgo: ${data?.length}`);

  const toRemove: AppVersion[] = [];

  // Check what to remove in between the major ranges, and keep the last one by default
  data?.forEach((row, index) => {
    if (semver.gte(row.name, bundle) && semver.lt(row.name, `${nextMajor}`)) {
        toRemove.push(row);
    }
  });

  console.log(`Active versions in Capgo between ${bundle} and ${nextMajor}: ${toRemove?.length}`);

  function removeLast(recent = true) {
    const last = toRemove.pop();
    if (last) {
      const date = new Date(last.created_at || '');
      const humanDate = date.toLocaleString();
      if(recent) {
        console.log(`${last.name} created on ${humanDate} will be kept as it's the last release`);
      } else {
        console.log(`${last.name} created on ${humanDate} will be kept due to config`);
      }
    }
  }

  // Always keep latest version
  removeLast(true);

  // Keep last 5
  removeLast(false);
  removeLast(false);
  removeLast(false);
  removeLast(false);

  if (toRemove.length > 0) {
    toRemove?.forEach(row => {
      const date = new Date(row.created_at || '');
      const humanDate = date.toLocaleString();
      console.log(`${row.name} created on ${humanDate} will be removed`);
    });

    const result = prompt("Do you want to continue removing the versions specified? Type yes to confirm");
    if (result === 'yes') {
      console.log("You have confiremd removal, removing versions now");

      toRemove?.forEach(row => {
        const date = new Date(row.created_at || '');
        const humanDate = date.toLocaleString();
        console.log(`Removing ${row.name} created on ${humanDate}`);
        deleteSpecificVersion(supabase, appid, userId, row.name);
      });
    } else {
      console.log("Not confirmed, aborting removal...")
    }
  } else {
    console.log("Nothing to be removed, aborting removal...")
  }



}
