import * as vscode from 'vscode';
import { logger, config } from '../extension';
import { getDebugConfigFolder } from '../utility';
import { isTokenExpired } from '../validateCredentials';
import { launchDebugProxyCommandName } from '.';

export async function getProxyUrl(cfg?: vscode.DebugConfiguration & { rootPath?: string; }) {
  try {
    const folder = getDebugConfigFolder(cfg);
    const credentials = await config.getStoredCloudCredentials();
    if (!credentials || isTokenExpired(credentials.token)) { return; }

    // if (!validateCredentials(credentials)) { return undefined; }
    const debugConfig = await config.getDebugConfig(folder, credentials);
    const proxyLaunched = await vscode.commands.executeCommand<boolean>(launchDebugProxyCommandName, debugConfig);
    if (!proxyLaunched) {
      throw new Error("Failed to launch debug proxy", { cause: { folder: folder.uri.fsPath, debugConfig } });
    }
    return `http://localhost:${config.getProxyPort(folder)}`;
  } catch (e) {
    logger.error("getProxyUrl", e);
    vscode.window.showErrorMessage(`Failed to get proxy URL`);
  }
}
