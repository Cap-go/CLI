import { program } from "commander";
import * as p from '@clack/prompts';
import { checkAppExistsAndHasPermissionErr } from "../api/app";
import { createChannel, findUnknownVersion } from "../api/channels";
import { OptionsBase, findSavedKey, getConfig, useLogSnag, createSupabaseClient, verifyUser } from "../utils";

interface Options extends OptionsBase {
    default?: boolean;
}

export const addChannel = async (channelId: string, appId: string, options: Options, shouldExit = true) => {
    p.intro(`Create channel`);
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
    await checkAppExistsAndHasPermissionErr(supabase, options.apikey, appId);

    p.log.info(`Creating channel ${appId}#${channelId} to Capgo`);
    try {
        const data = await findUnknownVersion(supabase, appId)
        if (!data) {
            p.log.error(`Cannot find default version for channel creation, please contact Capgo support 🤨`);
            program.error('');
        }
        await createChannel(supabase, {
            name: channelId,
            app_id: appId,
            version: data.id,
            created_by: userId
        });
        p.log.success(`Channel created ✅`);
        await snag.track({
            channel: 'channel',
            event: 'Create channel',
            icon: '✅',
            user_id: userId,
            tags: {
                'app-id': appId,
                'channel': channelId,
            },
            notify: false,
        }).catch()
    } catch (error) {
        p.log.error(`Cannot create Channel 🙀`);
        return false
    }
    if (shouldExit) {
        p.outro(`Done ✅`);
        process.exit()
    }
    return true
}


export const addChannelCommand = async (apikey: string, appId: string, options: Options) => {
    addChannel(apikey, appId, options, true)
}
