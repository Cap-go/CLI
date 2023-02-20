import { program } from "commander";
import { checkAppExistsAndHasPermission } from "../api/app";
import { createChannel, findUnknownVersion } from "../api/channels";
import { OptionsBase } from "../api/utils";
import { findSavedKey, getConfig, useLogSnag, createSupabaseClient, verifyUser } from "../utils";

export const addChannel = async (channelId: string, appId: string, options: OptionsBase) => {
    options.apikey = options.apikey || findSavedKey() || ''
    const config = await getConfig();
    appId = appId || config?.app?.appId
    const snag = useLogSnag()

    if (!options.apikey) {
        program.error("Missing API key, you need to provide a API key to upload your bundle");
    }
    if (!appId) {
        program.error("Missing argument, you need to provide a appId, or be in a capacitor project");
    }
    const supabase = createSupabaseClient(options.apikey)

    const userId = await verifyUser(supabase, options.apikey, ['write', 'all']);
    // Check we have app access to this appId
    await checkAppExistsAndHasPermission(supabase, appId, options.apikey);

    console.log(`Create channel ${appId}#${channelId} to Capgo cloud`);
    try {
        const data = await findUnknownVersion(supabase, appId)
        if (!data) {
            program.error(`Cannot find default version for channel creation, please contact Capgo support 🤨`);
        }
        await createChannel(supabase, { name: channelId, app_id: appId, version: data.id, created_by: userId });
        console.log(`Channel created ✅`);
        await snag.publish({
            channel: 'app',
            event: 'Create channel',
            icon: '✅',
            tags: {
                'user-id': userId,
                'app-id': appId,
                'channel': channelId,
            },
            notify: false,
        }).catch()
    } catch (error) {
        console.log(`Cannot create Channel 🙀`, error);
    }
    console.log(`Done ✅`);
    process.exit()
}
