import { program } from "commander";
import * as p from '@clack/prompts';
import { checkAppExistsAndHasPermissionErr } from "../api/app";
import { delChannel } from "../api/channels";
import { OptionsBase } from "../api/utils";
import { findSavedKey, getConfig, useLogSnag, createSupabaseClient, verifyUser } from "../utils";

export const deleteChannel = async (channelId: string, appId: string, options: OptionsBase) => {
    p.intro(`Delete channel`);
    options.apikey = options.apikey || findSavedKey()
    const config = await getConfig();
    appId = appId || config?.app?.appId
    const snag = useLogSnag()

    if (!options.apikey) {
        p.log.error("Missing API key, you need to provide a API key to upload your bundle");
        program.error('');
    }
    if (!appId) {
        p.log.error("Missing argument, you need to provide a appId, or be in a capacitor project");
        program.error('');
    }
    const supabase = await createSupabaseClient(options.apikey)

    const userId = await verifyUser(supabase, options.apikey, ['write', 'all']);
    // Check we have app access to this appId
    await checkAppExistsAndHasPermissionErr(supabase, appId);

    p.log.info(`Deleting channel ${appId}#${channelId} from Capgo`);
    try {
        await delChannel(supabase, channelId, appId, userId);
        p.log.success(`Channel deleted`);
        await snag.track({
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
        p.log.error(`Cannot delete Channel 🙀`);
    }
    p.outro(`Done ✅`);
    process.exit()
}
