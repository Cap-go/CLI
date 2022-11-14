import { program } from 'commander';
import semver from 'semver/preload';
import promptSync from 'prompt-sync';
import { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient, findSavedKey, getConfig, verifyUser } from './utils';
import { definitions } from './types_supabase';
import { deleteSpecificVersion } from './deleteSpecificVersion';

interface Options {
  apikey: string;
  version: string;
  bundle: string;
}

type AppVersion = {
  id: number;
  created_at?: string;
  app_id: string;
  name: string;
  bucket_id?: string;
  user_id: string;
  updated_at?: string;
  deleted: boolean;
  external_url?: string;
  checksum?: string;
};

const prompt = promptSync();

function removeVersions(toRemove: AppVersion[], supabase: SupabaseClient, appid: string, userId: string) {
  toRemove?.forEach(row => {
    console.log(`Removing ${row.name} created on ${(getHumanDate(row))}`);
    deleteSpecificVersion(supabase, appid, userId, row.name);
  });
}

function getHumanDate(row: AppVersion) {
  const date = new Date(row.created_at || '');
  return date.toLocaleString();
}

async function checkAppExistsAndHasPermission(supabase: SupabaseClient, appid: string, apikey: string) {
  const { data: app, error: dbError0 } = await supabase
    .rpc<string>('exist_app', { appid, apikey });
  if (!app || dbError0) {
    program.error('No permission for this app');
  }
}

async function getActiveAppVersions(supabase: SupabaseClient, appid: string, userId: string) {
  const { data, error: vError } = await supabase
    .from<definitions['app_versions']>('app_versions')
    .select()
    .eq('app_id', appid)
    .eq('user_id', userId)
    .eq('deleted', false);

  if (vError) {
    program.error(`App ${appid} not found in database ${vError} `);
  }
  return data;
}

function getRemovableVersionsInSemverRange(data: AppVersion[], bundle: string, nextMajor: string) {
  const toRemove: AppVersion[] = [];

  data?.forEach(row => {
    if (semver.gte(row.name, bundle) && semver.lt(row.name, `${nextMajor}`)) {
      toRemove.push(row);
    }
  });
  return toRemove;
}

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

  // Check we have app access to this appId
  await checkAppExistsAndHasPermission(supabase, appid, apikey);

  // Get all active app versions we might possibly be able to cleanup
  const data = await getActiveAppVersions(supabase, appid, userId);

  console.log(`Total active versions in Capgo: ${data?.length}`);

  if (data?.length === 0) {
    return;
  }

  // Get all app versions that are in the given range
  const toRemove = getRemovableVersionsInSemverRange(data, bundle, nextMajor);

  console.log(`Active versions in Capgo between ${bundle} and ${nextMajor}: ${toRemove?.length}`);

  function removeLast(recent = true) {
    const last = toRemove.pop();
    if (last) {
      const humanDate = getHumanDate(last);
      if (recent) {
        console.log(`${last.name} created on ${humanDate} will be kept as it's the last release`);
      } else {
        console.log(`${last.name} created on ${humanDate} will be kept due to config`);
      }
    }
  }

  // Always keep the latest version
  removeLast(true);

  // Keep the previous 4 as well
  removeLast(false);
  removeLast(false);
  removeLast(false);
  removeLast(false);

  if (toRemove.length === 0) {
    console.log("Nothing to be removed, aborting removal...")
    return;
  }

  // Show the user what will be removed
  toRemove?.forEach(row => {
    console.log(`${row.name} created on ${(getHumanDate(row))} will be removed`);
  });

  // Check user wants to clean that all up
  const result = prompt("Do you want to continue removing the versions specified? Type yes to confirm");
  if (result !== "yes") {
    console.log("Not confirmed, aborting removal...");
    return;
  }

  // Yes, lets clean it up
  console.log("You have confiremd removal, removing versions now");
  removeVersions(toRemove, supabase, appid, userId);
}
