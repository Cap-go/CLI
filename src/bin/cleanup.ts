import { program } from 'commander';
import semver from 'semver/preload';
import promptSync from 'prompt-sync';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'types/supabase.types';
import { createSupabaseClient, findSavedKey, getConfig, getHumanDate, verifyUser } from './utils';
import { deleteSpecificVersion, displayBundles, getActiveAppVersions } from '../api/versions';
import { checkAppExistsAndHasPermission } from '../api/app';
// import { definitions } from '../types/types_supabase';

interface Options {
  apikey: string;
  version: string;
  bundle: string;
  keep: number;
  force: boolean;
}

const prompt = promptSync();

const removeVersions = (toRemove: Database['public']['Tables']['app_versions']['Row'][],
  supabase: SupabaseClient, appid: string, userId: string) => {
  toRemove?.forEach(row => {
    console.log(`Removing ${row.name} created on ${(getHumanDate(row))}`);
    deleteSpecificVersion(supabase, appid, userId, row.name);
  });
}

const getRemovableVersionsInSemverRange = (data: Database['public']['Tables']['app_versions']['Row'][],
  bundle: string, nextMajor: string) => {
  const toRemove: Database['public']['Tables']['app_versions']['Row'][] = [];

  data?.forEach(row => {
    if (semver.gte(row.name, bundle) && semver.lt(row.name, `${nextMajor}`)) {
      toRemove.push(row);
    }
  });
  return toRemove;
}

export const cleanupApp = async (appid: string, options: Options) => {
  const apikey = options.apikey || findSavedKey()
  const { bundle, keep = 4 } = options;
  const force = options.force || false;

  const config = await getConfig();
  appid = appid || config?.app?.appId
  if (!apikey) {
    program.error('Missing API key, you need to provide an API key to delete your app');
  }
  if (!appid) {
    program.error('Missing argument, you need to provide a appid, or be in a capacitor project');
  }
  const supabase = createSupabaseClient(apikey)

  const userId = await verifyUser(supabase, apikey);

  // Check we have app access to this appId
  await checkAppExistsAndHasPermission(supabase, appid, apikey);
  console.log(`Querying all available versions in Capgo`);

  // Get all active app versions we might possibly be able to cleanup
  let allVersions: (Database['public']['Tables']['app_versions']['Row'] & { keep?: string })[] = await
    getActiveAppVersions(supabase, appid, userId);

  console.log(`Total active versions in Capgo: ${allVersions?.length}`);
  if (allVersions?.length === 0) {
    console.log('No versions found, aborting cleanup');
    return;
  }
  if (bundle) {
    const nextMajor = `${semver.inc(bundle, 'major')}`;
    console.log(`Querying available versions in Capgo between ${bundle} and ${nextMajor}`);

    // Get all app versions that are in the given range
    allVersions = getRemovableVersionsInSemverRange(allVersions, bundle, nextMajor)
      .reverse() as (Database['public']['Tables']['app_versions']['Row'] & { keep: string })[];

    console.log(`Active versions in Capgo between ${bundle} and ${nextMajor}: ${allVersions?.length}`);
  }

  // Slice to keep and remove

  const toRemove: (Database['public']['Tables']['app_versions']['Row'] & { keep: string })[] = []
  // Slice to keep and remove
  allVersions.forEach((v, i) => {
    if (i < keep) {
      v.keep = '✅';
    } else {
      v.keep = '❌';
      toRemove.push(v);
    }
  })

  if (toRemove.length === 0) {
    console.log("Nothing to be removed, aborting removal...")
    return;
  }
  displayBundles(allVersions);

  // Check user wants to clean that all up
  if (!force) {
    const result = prompt("Do you want to continue removing the versions specified? Type yes to confirm");
    if (result !== "yes") {
      console.log("Not confirmed, aborting removal...");
      return;
    }
  }

  // Yes, lets clean it up
  console.log("You have confirmed removal, removing versions now");
  removeVersions(toRemove, supabase, appid, userId);
}
