import { program } from "commander";
import * as p from '@clack/prompts';
import { checkAppExistsAndHasPermissionErr } from '../api/app';
import { createSupabaseClient, findSavedKey, getConfig, useLogSnag, verifyUser, OptionsBase } from "../utils";

export const deleteApp = async (appId: string, options: OptionsBase) => {
    p.intro(`Deleting`);
    options.apikey = options.apikey || findSavedKey()
    const config = await getConfig();
    appId = appId || config?.app?.appId
    const snag = useLogSnag()

    if (!options.apikey) {
        p.log.error('Missing API key, you need to provide a API key to upload your bundle');
        program.error('');
    }
    if (!appId) {
        p.log.error('Missing argument, you need to provide a appId, or be in a capacitor project');
        program.error('');
    }
    const supabase = await createSupabaseClient(options.apikey)

    const userId = await verifyUser(supabase, options.apikey, ['write', 'all']);
    // Check we have app access to this appId
    await checkAppExistsAndHasPermissionErr(supabase, options.apikey, appId);

    const { error } = await supabase
        .storage
        .from(`images/${userId}`)
        .remove([appId])
    if (error) {
        p.log.error('Could not delete app logo');
    }
    const { error: delError } = await supabase
        .storage
        .from(`apps/${appId}/${userId}`)
        .remove(['versions'])
    if (delError) {
        p.log.error('Could not delete app version');
        program.error('');
    }

    const { error: dbError } = await supabase
        .from('apps')
        .delete()
        .eq('app_id', appId)
        .eq('user_id', userId)

    if (dbError) {
        p.log.error('Could not delete app');
        program.error('');
    }
    await snag.track({
        channel: 'app',
        event: 'App Deleted',
        icon: '🗑️',
        user_id: userId,
        tags: {
            'app-id': appId,
        },
        notify: false,
    }).catch()
    p.log.success(`App deleted in Capgo`);
    p.outro('Done ✅');
    process.exit()
}
