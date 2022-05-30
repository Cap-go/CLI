import { loadConfig } from '@capacitor/cli/dist/config';
import { program } from 'commander';
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { definitions } from './types_supabase';

export const host = 'https://capgo.app';
export const hostWeb = 'https://web.capgo.app';
// export const hostSupa = 'https://xvwzpoazmxkqosrdewyv.functions.supabase.co';
export const hostSupa = 'https://aucsybvnhavogdmzwtcw.supabase.co';

// For local test purposes
// export const host = 'http://localhost:3334';

/* eslint-disable */
// export const supaAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTYzNzgwNTAwOSwiZXhwIjoxOTUzMzgxMDA5fQ.8tgID1d4jodPwuo_fz4KHN4o1XKB9fnqyt0_GaJSj-w'
export const supaAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1Y3N5YnZuaGF2b2dkbXp3dGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NTM1ODcxNjgsImV4cCI6MTk2OTE2MzE2OH0.8FKKJqiGgoVA3p9GH5wvnbWkWywIxVLqQyZFhupZ7C4'
/* eslint-enable */

export const createSupabaseClient = (apikey: string) => createClient(hostSupa, supaAnon, {
    headers: {
        capgkey: apikey,
    }
})
interface Config {
    app: {
        appId: string;
        appName: string;
        webDir: string;
        package: {
            version: string;
        };
    };
}
export const getConfig = async () => {
    let config: Config;
    try {
        config = await loadConfig();
    } catch (err) {
        program.error("No capacitor config file found, run `cap init` first");
    }
    return config;
}

export const checkAppOwner = async (supabase: SupabaseClient, userId: any, appId: string | undefined): Promise<boolean> => {
    if (!appId || !userId)
        return false
    try {
        const { data, error } = await supabase
            .from<definitions['apps']>('apps')
            .select()
            .eq('user_id', userId)
            .eq('app_id', appId)
        if (!data || !data.length || error)
            return false
        return true
    }
    catch (error) {
        console.error(error)
        return false
    }
}

export const updateOrCreateVersion = async (supabase: SupabaseClient, update: Partial<definitions['app_versions']>) => {
    // eslint-disable-next-line no-console
    console.log('updateOrCreateVersion', update)
    const { data, error } = await supabase
        .from<definitions['app_versions']>('app_versions')
        .select()
        .eq('app_id', update.app_id)
        .eq('name', update.name)
    if (data && data.length && !error) {
        // eslint-disable-next-line no-console
        console.log('update Version')
        update.deleted = false
        return supabase
            .from<definitions['app_versions']>('app_versions')
            .update(update)
            .eq('app_id', update.app_id)
            .eq('name', update.name)
    }

    return supabase
        .from<definitions['app_versions']>('app_versions')
        .insert(update)

}

export const updateOrCreateChannel = async (supabase: SupabaseClient, update: Partial<definitions['channels']>) => {
    // eslint-disable-next-line no-console
    console.log('updateOrCreateChannel', update)
    if (!update.app_id || !update.name || !update.created_by) {
        console.error('missing app_id, name, or created_by')
        return Promise.reject(new Error('missing app_id, name, or created_by'))
    }
    const { data, error } = await supabase
        .from<definitions['channels']>('channels')
        .select()
        .eq('app_id', update.app_id)
        .eq('name', update.name)
        .eq('created_by', update.created_by)
    if (data && data.length && !error) {
        return supabase
            .from<definitions['channels']>('channels')
            .update(update)
            .eq('app_id', update.app_id)
            .eq('name', update.name)
            .eq('created_by', update.created_by)
    }

    return supabase
        .from<definitions['channels']>('channels')
        .insert(update)
}