import { program } from 'commander';
import * as p from '@clack/prompts';
import { getVersionData } from 'api/versions';
import { checkVersionNotUsedInDeviceOverride } from '../api/devices_override';
import { checkVersionNotUsedInChannel } from '../api/channels';
import { checkAppExistsAndHasPermissionErr } from "../api/app";
import {
    OptionsBase,
    getConfig, createSupabaseClient,
    formatError, findSavedKey, checkPlanValid, useLogSnag, verifyUser
} from '../utils';

interface Options extends OptionsBase {
    bundle?: string
}

export const unlinkDevice = async (channel: string, appId: string, options: Options) => {
    p.intro(`Unlink bundle`);
    options.apikey = options.apikey || findSavedKey()
    const config = await getConfig();
    appId = appId || config?.app?.appId
    const snag = useLogSnag()
    let { bundle } = options;

    bundle = bundle || config?.app?.package?.version

    if (!options.apikey) {
        p.log.error("Missing API key, you need to provide a API key to upload your bundle");
        program.error('');
    }
    if (!appId) {
        p.log.error("Missing argument, you need to provide a appId, or be in a capacitor project");
        program.error('');
    }
    if (!bundle) {
        p.log.error("Missing argument, you need to provide a bundle, or be in a capacitor project");
        program.error('');
    }
    const supabase = await createSupabaseClient(options.apikey)

    const userId = await verifyUser(supabase, options.apikey, ['write', 'all']);
    // Check we have app access to this appId
    await checkAppExistsAndHasPermissionErr(supabase, options.apikey, appId);

    if (!channel) {
        p.log.error("Missing argument, you need to provide a channel");
        program.error('');
    }
    try {
        await checkPlanValid(supabase, userId, appId, options.apikey)

        const versionData = await getVersionData(supabase, appId, userId, bundle);
        await checkVersionNotUsedInChannel(supabase, appId, userId, versionData);
        await checkVersionNotUsedInDeviceOverride(supabase, appId, versionData);
        await snag.track({
            channel: 'bundle',
            event: 'Unlink bundle',
            icon: '✅',
            user_id: userId,
            tags: {
                'app-id': appId,
            },
            notify: false,
        }).catch()
    } catch (err) {
        p.log.error(`Unknow error ${formatError(err)}`);
        program.error('');
    }
    p.outro('Done ✅');
    process.exit()
}
