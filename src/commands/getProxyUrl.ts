import * as vscode from 'vscode';
import { logger, config } from '../extension';
import { getDebugConfigFolder } from '../utils';
import { validateCredentials } from '../userFlows';


export const getProxyUrlCommandName = "dbos-ttdbg.get-proxy-url";
export async function getProxyUrl(cfg?: vscode.DebugConfiguration & { rootPath?: string; }) {
  try {
    const folder = getDebugConfigFolder(cfg);
    const credentials = await config.getStoredCloudCredentials();
    if (!validateCredentials(credentials)) { return undefined; }
    const cloudConfig = await config.getDebugConfig(folder, credentials);

    // TODO
    vscode.window.showErrorMessage("getProxyUrl currently disabled");
    return undefined;

    // const proxyLaunched = await launchDebugProxy(folder, cloudConfig);
    // if (!proxyLaunched) {
    //   throw new Error("Failed to launch debug proxy", { cause: { folder: folder.uri.fsPath, cloudConfig } });
    // }
    // return `http://localhost:${config.getProxyPort(folder)}`;
  } catch (e) {
    logger.error("getProxyUrl", e);
    vscode.window.showErrorMessage(`Failed to get proxy URL`);
  }
}
