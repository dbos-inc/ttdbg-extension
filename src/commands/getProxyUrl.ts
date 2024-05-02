import * as vscode from 'vscode';
import { logger, config } from '../extension';
import { getDebugConfigFolder } from '../utils';

export async function getProxyUrl(cfg?: vscode.DebugConfiguration & { rootPath?: string; }) {
  try {
    const folder = getDebugConfigFolder(cfg);
    const credentials = await config.getStoredCloudCredentials();
    if (!credentials) { return; }

    // TODO
    vscode.window.showErrorMessage("getProxyUrl currently disabled");
    return undefined;

    // if (!validateCredentials(credentials)) { return undefined; }
    // const cloudConfig = await config.getDebugConfig(folder, credentials);


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
