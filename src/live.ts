import { writeConfig } from '@capacitor/cli/dist/config';
// import * as p from '@clack/prompts';
import { getConfig } from './utils';

interface Options {
  url?: string;
}

export const setLive = async (options: Options) => {
  const config = await getConfig();
  const { extConfig } = config.app;
  let server = {}
  if (typeof extConfig.server !== 'undefined') {
    extConfig.server = {
      url: options.url!,
      cleartext: true
    };
  } else {
    server = extConfig.server;
  }
  writeConfig(extConfig, config.app.extConfigFilePath);
  return server
}

export const unsetLive = async (server: any) => {
  const config = await getConfig();
  const { extConfig } = config.app;
  extConfig.server = server;
  writeConfig(extConfig, config.app.extConfigFilePath);
}