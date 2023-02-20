import { program } from 'commander';
import { Database } from 'types/supabase.types';
import { Table } from 'console-table-printer';
import { SupabaseClient } from '@supabase/supabase-js';
import { checkAppExistsAndHasPermission } from '../api/app';
import { OptionsBase } from '../api/utils';
import { createSupabaseClient, findSavedKey, formatError, getConfig, getHumanDate, verifyUser } from '../utils';
import { checkLatest } from '../api/update';

const displayApp = (data: Database['public']['Tables']['apps']['Row'][]) => {
  const p = new Table({
    title: "Apps",
    charLength: { "❌": 2, "✅": 2 },
  });

  // add rows with color
  data.reverse().forEach(row => {
    p.addRow({
      Name: row.name,
      Created: getHumanDate(row.created_at)
    });
  });

  p.printTable();
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
  await checkLatest();
  options.apikey = options.apikey || findSavedKey()
  const config = await getConfig();

  appId = appId || config?.app?.appId
  if (!options.apikey) {
    program.error('Missing API key, you need to provide an API key to delete your app');
  }
  if (!appId) {
    program.error('Missing argument, you need to provide a appid, or be in a capacitor project');
  }

  const supabase = createSupabaseClient(options.apikey)

  const userId = await verifyUser(supabase, options.apikey);

  console.log(`Querying available versions in Capgo`);

  // Check we have app access to this appId
  await checkAppExistsAndHasPermission(supabase, appId, options.apikey);

  // Get all active app versions we might possibly be able to cleanup
  const allApps = await getActiveApps(supabase, userId);

  console.log(`Active app in Capgo: ${allApps?.length}`);

  displayApp(allApps);
  console.log(`Done ✅`);
  process.exit()
}
