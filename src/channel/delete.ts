import { program } from "commander";
import { checkAppExistsAndHasPermissionErr } from "../api/app";
import { delChannel } from "../api/channels";
import { OptionsBase } from "../api/utils";
import { findSavedKey, getConfig, useLogSnag, createSupabaseClient, verifyUser } from "../utils";

export const deleteChannel = async (channelId: string, appId: string, options: OptionsBase) => {
    options.apikey = options.apikey || findSavedKey()
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
    await checkAppExistsAndHasPermissionErr(supabase, appId, options.apikey);

    console.log(`Delete channel ${appId}#${channelId} to Capgo cloud`);
    try {
        await delChannel(supabase, channelId, appId, userId);
        console.log(`Channel Delete ✅`);
        await snag.publish({
            channel: 'channel',
            event: 'Delete channel',
            icon: '✅',
            tags: {
                'user-id': userId,
                'app-id': appId,
                'channel': channelId,
            },
            notify: false,
        }).catch()
    } catch (error) {
        console.log(`Cannot delete Channel 🙀`, error);
    }
    console.log(`Done ✅`);
    process.exit()
}