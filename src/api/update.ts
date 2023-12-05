import getLatest from "get-latest-version"
import * as p from '@clack/prompts';
import { JsonLogger } from "../json_logger";
import pack from '../../package.json'

export const checkLatest = async (logger: JsonLogger | undefined) => {
    const latest = await getLatest('@capgo/cli')
    if (latest !== pack.version) {
        const message = `🚨 You are using @capgo/cli@${pack.version} it's not the latest version.
Please use @capgo/cli@${latest}" or @capgo/cli@latest to keep up to date with the latest features and bug fixes.`;
        logger ? logger.warning(message) : p.log.warn(message)
    }
}