import { loadConfig } from '@capacitor/cli/dist/config';
import { program } from 'commander';
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import prettyjson from 'prettyjson';
import fs from 'fs'
import os from 'os'
import { definitions } from './types_supabase';

export const host = 'https://capgo.app';
export const hostWeb = 'https://web.capgo.app';
export const hostSupa = process.env.SUPA_DB === 'production'
    ? 'https://xvwzpoazmxkqosrdewyv.supabase.co' : 'https://aucsybvnhavogdmzwtcw.supabase.co';

if (process.env.SUPA_DB !== 'production') {
    console.log('hostSupa', hostSupa);
}
/* eslint-disable */
export const supaAnon = process.env.SUPA_DB === 'production'
    ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTYzNzgwNTAwOSwiZXhwIjoxOTUzMzgxMDA5fQ.8tgID1d4jodPwuo_fz4KHN4o1XKB9fnqyt0_GaJSj-w'
    : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1Y3N5YnZuaGF2b2dkbXp3dGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NTQ1Mzk1MDYsImV4cCI6MTk3MDExNTUwNn0.HyuZmo_EjF5fgZQU3g37bdNardK1CLHgxXmYqtr59bo'
/* eslint-enable */

export const createSupabaseClient = (apikey: string) => createClient(hostSupa, supaAnon, {
    headers: {
        capgkey: apikey,
    }
})

export const checkKey = async (supabase: SupabaseClient, apikey: string, keymode: string[]) => {
    const { data: apiAccess, error: apiAccessError } = await supabase
        .rpc('is_allowed_capgkey', { apikey, keymode })

    if (!apiAccess || apiAccessError) {
        program.error(`Invalid API key or insufficient rights ${formatError(apiAccessError)}`);
    }
}

export const isGoodPlan = async (supabase: SupabaseClient, userId: string): Promise<boolean> => {
    const { data, error } = await supabase
        .rpc<boolean>('is_good_plan', { userid: userId })
        .single()
    if (error) {
        throw error
    }
    return data || false
}

export const isTrial = async (supabase: SupabaseClient, userId: string): Promise<number> => {
    const { data, error } = await supabase
        .rpc<number>('is_trial', { userid: userId })
        .single()
    if (error) {
        throw error
    }
    return data || 0
}

export const checkPlan = async (supabase: SupabaseClient, userId: string, warning = true) => {
    let validPlan = await isGoodPlan(supabase, userId)
    const trialDays = await isTrial(supabase, userId)
    if (trialDays > 0) {
        validPlan = true
    }
    if (!validPlan) {
        program.error(`You need to upgrade your plan to continue to use capgo.\n Upgrade here: ${hostWeb}/app/usage\n`);
    }
    if (trialDays > 0 && warning) {
        console.log(`WARNING !!\nTrial expires in ${trialDays} days, upgrade here: ${hostWeb}/app/usage\n`);
    }
}

export const findSavedKey = () => {
    // search for key in home dir
    const userHomeDir = os.homedir();
    let keyPath = `${userHomeDir}/.capgo`;
    if (fs.existsSync(keyPath)) {
        const key = fs.readFileSync(keyPath, 'utf8');
        return key.trim();
    }
    keyPath = `.capgo`;
    if (fs.existsSync(keyPath)) {
        const key = fs.readFileSync(keyPath, 'utf8');
        return key.trim();
    }
    return null
}

export const formatError = (error: any) => error ? `\n${prettyjson.render(error)}` : ''

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

export const updateOrCreateVersion = async (supabase: SupabaseClient, update: Partial<definitions['app_versions']>, apikey: string) => {
    // console.log('updateOrCreateVersion', update, apikey)
    const { data, error } = await supabase
        .rpc<string>('exist_app_versions', { appid: update.app_id, name_version: update.name, apikey })
    if (data && !error) {
        update.deleted = false
        return supabase
            .from<definitions['app_versions']>('app_versions')
            .update(update)
            .eq('app_id', update.app_id)
            .eq('name', update.name)
    }
    // console.log('create Version', data, error)

    return supabase
        .from<definitions['app_versions']>('app_versions')
        .insert(update)

}

export const updateOrCreateChannel = async (supabase: SupabaseClient, update: Partial<definitions['channels']>, apikey: string) => {
    // console.log('updateOrCreateChannel', update)
    if (!update.app_id || !update.name || !update.created_by) {
        console.error('missing app_id, name, or created_by')
        return Promise.reject(new Error('missing app_id, name, or created_by'))
    }
    const { data, error } = await supabase
        .rpc<string>('exist_channel', { appid: update.app_id, name_channel: update.name, apikey })
    if (data && !error) {
        return supabase
            .from<definitions['channels']>('channels')
            .update(update, { returning: "minimal" })
            .eq('app_id', update.app_id)
            .eq('name', update.name)
            .eq('created_by', update.created_by)
    }
    // console.log('create Channel', data, error)

    return supabase
        .from<definitions['channels']>('channels')
        .insert(update, { returning: "minimal" })
}