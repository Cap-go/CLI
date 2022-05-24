import { loadConfig } from '@capacitor/cli/dist/config';
import { program } from 'commander';

export const host = 'https://capgo.app';
export const hostWeb = 'https://web.capgo.app';
export const hostSupa = 'https://xvwzpoazmxkqosrdewyv.functions.supabase.co';
// export const hostSupa = 'https://aucsybvnhavogdmzwtcw.functions.supabase.co';

// For local test purposes
// export const host = 'http://localhost:3334';

/* eslint-disable */
export const supaAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTYzNzgwNTAwOSwiZXhwIjoxOTUzMzgxMDA5fQ.8tgID1d4jodPwuo_fz4KHN4o1XKB9fnqyt0_GaJSj-w'
// export const supaAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1Y3N5YnZuaGF2b2dkbXp3dGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NTE4NDE4MjMsImV4cCI6MTk2NzQxNzgyM30.AYzjGigPxlTw4eEkCjoGfYph8WRU3QXgIDcMWptQyAQ'
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