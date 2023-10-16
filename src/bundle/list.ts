import { program } from 'commander';
import * as p from '@clack/prompts';
import { checkAppExistsAndHasPermissionErr } from '../api/app';
import { OptionsBase } from '../api/utils';
import { getActiveAppVersions, displayBundles } from '../api/versions';
import { createSupabaseClient, findSavedKey, getConfig, verifyUser } from '../utils';
import { checkLatest } from '../api/update';

export const listBundle = async (appId: string, options: OptionsBase) => {
    p.intro(`List bundles`);
    await checkLatest();
    options.apikey = options.apikey || findSavedKey()
    const config = await getConfig();

    appId = appId || config?.app?.appId
    if (!options.apikey) {
        p.log.error("Missing API key, you need to provide a API key to upload your bundle");
        program.error('');
    }
    if (!appId) {
        p.log.error("Missing argument, you need to provide a appid, or be in a capacitor project");
        program.error('');
    }

    const supabase = createSupabaseClient(options.apikey)

    const userId = await verifyUser(supabase, options.apikey, ['write', 'all', 'read', 'upload']);

    p.log.info(`Querying available versions of: ${appId} in Capgo`);

    // Check we have app access to this appId
    await checkAppExistsAndHasPermissionErr(supabase, appId);

    // Get all active app versions we might possibly be able to cleanup
    const allVersions = await getActiveAppVersions(supabase, appId, userId);

    p.log.info(`Active versions in Capgo: ${allVersions?.length}`);

    displayBundles(allVersions);
    p.outro(`Done ✅`);
    process.exit()
}
