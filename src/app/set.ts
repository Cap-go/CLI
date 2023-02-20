import { getType } from 'mime';
import { program } from "commander";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs-extra";
import { checkAppExistsAndHasPermission, newIconPath, Options } from '../api/app';
import { createSupabaseClient, findSavedKey, formatError, getConfig, verifyUser } from "../utils";

export const setApp = async (appId: string, options: Options) => {
    options.apikey = options.apikey || findSavedKey()
    const config = await getConfig();
    appId = appId || config?.app?.appId

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

    const { name, icon } = options;

    let iconBuff;
    let iconType;
    const fileName = `icon_${randomUUID()}`
    let signedURL = 'https://xvwzpoazmxkqosrdewyv.supabase.co/storage/v1/object/public/images/capgo.png'

    if (icon && existsSync(icon)) {
        iconBuff = readFileSync(icon);
        const contentType = getType(icon);
        iconType = contentType || 'image/png';
        console.warn(`Found app icon ${icon}`);
    }
    else if (existsSync(newIconPath)) {
        iconBuff = readFileSync(newIconPath);
        const contentType = getType(newIconPath);
        iconType = contentType || 'image/png';
        console.warn(`Found app icon ${newIconPath}`);
    } else {
        console.warn(`Cannot find app icon in any of the following locations: ${icon}, ${newIconPath}`);
    }
    if (iconBuff && iconType) {
        const { error } = await supabase.storage
            .from(`images/${userId}/${appId}`)
            .upload(fileName, iconBuff, {
                contentType: iconType,
            })
        if (error) {
            program.error(`Could not add app ${formatError(error)}`);
        }
        const { data: signedURLData } = await supabase
            .storage
            .from(`images/${userId}/${appId}`)
            .getPublicUrl(fileName)
        signedURL = signedURLData?.publicUrl || signedURL
    }
    const { error: dbError } = await supabase
        .from('apps')
        .update({
            icon_url: signedURL,
            name,
        })
        .eq('app_id', appId)
        .eq('user_id', userId)
    if (dbError) {
        program.error(`Could not add app ${formatError(dbError)}`);
    }
    console.log(`Done ✅`);
    process.exit()
}
