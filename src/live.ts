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
  if (!extConfig.server) {
    extConfig.server = {};
  } else {
    server = extConfig.server;
  }
  extConfig.server.url = options.url;
  extConfig.server.cleartext = true;
  writeConfig(extConfig, config.app.extConfigFilePath);
  return server
}

export const unsetLive = async (server: any) => {
  const config = await getConfig();
  const { extConfig } = config.app;
  extConfig.server = server;
  writeConfig(extConfig, config.app.extConfigFilePath);
}