import { CapacitorConfig } from '@capacitor/cli';
import { loadConfig } from '@capacitor/cli/dist/config';
import { program } from 'commander';

export const host = 'https://capgo.app';
export const hostWeb = 'https://web.capgo.app';
export const hostSupa = 'https://aucsybvnhavogdmzwtcw.functions.supabase.co';
export const hostAdd = 'https://aucsybvnhavogdmzwtcw.functions.supabase.co/add';
export const hostUpload = 'https://aucsybvnhavogdmzwtcw.functions.supabase.co/upload';
export const hostDelete = 'https://aucsybvnhavogdmzwtcw.functions.supabase.co/delete';
export const hostSet = 'https://aucsybvnhavogdmzwtcw.functions.supabase.co/channel';

// For local test purposes
// export const host = 'http://localhost:3334';

/* eslint-disable */
export const supaAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTYzNzgwNTAwOSwiZXhwIjoxOTUzMzgxMDA5fQ.8tgID1d4jodPwuo_fz4KHN4o1XKB9fnqyt0_GaJSj-w'
/* eslint-enable */

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