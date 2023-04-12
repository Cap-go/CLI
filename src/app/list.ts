import { program } from 'commander';
import { Database } from 'types/supabase.types';
import { Table } from 'console-table-printer';
import { SupabaseClient } from '@supabase/supabase-js';
import * as p from '@clack/prompts';
import { checkAppExistsAndHasPermissionErr } from '../api/app';
import { OptionsBase } from '../api/utils';
import { createSupabaseClient, findSavedKey, formatError, getConfig, getHumanDate, verifyUser } from '../utils';
import { checkLatest } from '../api/update';

const displayApp = (data: Database['public']['Tables']['apps']['Row'][]) => {
  const t = new Table({
    title: "Apps",
    charLength: { "❌": 2, "✅": 2 },
  });

  // add rows with color
  data.reverse().forEach(row => {
    t.addRow({
      Name: row.name,
      Created: getHumanDate(row.created_at)
    });
  });

  t.printTable();
}

export const getActiveApps = async (supabase: SupabaseClient<Database>, userId: string) => {
  const { data, error: vError } = await supabase
    .from('apps')
    .select()
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (vError) {
    program.error(`Apps not found in database ${formatError(vError)} `);
  }
  return data;
}

export const listApp = async (appId: string, options: OptionsBase) => {
  p.intro(`List apps in Capgo`);

  await checkLatest();
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig();

  appId = appId || config?.app?.appId
  if (!options.apikey) {
    p.log.error(`Missing API key, you need to provide an API key to delete your app`);
    program.error('');
  }
  if (!appId) {
    p.log.error("Missing argument, you need to provide a appId, or be in a capacitor project");
    program.error('');
  }

  const supabase = createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey);

  p.log.info(`Getting active bundle in Capgo`);

  // Check we have app access to this appId
  await checkAppExistsAndHasPermissionErr(supabase, appId, options.apikey);

  // Get all active app versions we might possibly be able to cleanup
  const allApps = await getActiveApps(supabase, userId);

  p.log.info(`Active app in Capgo: ${allApps?.length}`);

  displayApp(allApps);
  p.outro(`Done ✅`);
  process.exit()
}
