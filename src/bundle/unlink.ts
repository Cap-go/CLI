import { program } from 'commander';
import { getVersionData } from 'api/versions';
import { checkVersionNotUsedInDeviceOverride } from '../api/devices_override';
import { checkVersionNotUsedInChannel } from '../api/channels';
import { OptionsBase } from '../api/utils';
import { checkAppExistsAndHasPermissionErr } from "../api/app";
import {
    getConfig, createSupabaseClient,
    formatError, findSavedKey, checkPlanValid, useLogSnag, verifyUser
} from '../utils';

interface Options extends OptionsBase {
    bundle?: string
}

export const unlinkDevice = async (channel: string, appId: string, options: Options) => {
    options.apikey = options.apikey || findSavedKey()
    const config = await getConfig();
    appId = appId || config?.app?.appId
    const snag = useLogSnag()
    let { bundle } = options;

    bundle = bundle || config?.app?.package?.version

    if (!options.apikey) {
        program.error("Missing API key, you need to provide a API key to upload your bundle");
    }
    if (!appId) {
        program.error("Missing argument, you need to provide a appId, or be in a capacitor project");
    }
    if (!bundle) {
        program.error("Missing argument, you need to provide a bundle, or be in a capacitor project");
    }
    const supabase = createSupabaseClient(options.apikey)

    const userId = await verifyUser(supabase, options.apikey, ['write', 'all']);
    // Check we have app access to this appId
    await checkAppExistsAndHasPermissionErr(supabase, appId, options.apikey);

    if (!channel) {
        program.error("Missing argument, you need to provide a channel");
    }
    try {
        await checkPlanValid(supabase, userId)

        const versionData = await getVersionData(supabase, appId, userId, bundle);
        await checkVersionNotUsedInChannel(supabase, appId, userId, versionData);
        await checkVersionNotUsedInDeviceOverride(supabase, appId, versionData);
        await snag.publish({
            channel: 'bundle',
            event: 'Unlink bundle',
            icon: '✅',
            tags: {
                'user-id': userId,
                'app-id': appId,
            },
            notify: false,
        }).catch()
    } catch (err) {
        program.error(`Unknow error ${formatError(err)}`);
    }
    console.log(`Done ✅`);
    process.exit()
}