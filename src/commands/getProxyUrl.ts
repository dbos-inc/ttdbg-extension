import * as vscode from 'vscode';
import { logger, config } from '../extension';
import { getDebugConfigFolder } from '../utility';
import { validateCredentials } from '../validateCredentials';
import { launchDebugProxyCommandName } from '.';

export async function getProxyUrl(cfg?: vscode.DebugConfiguration & { rootPath?: string; }) {
  try {
    const folder = getDebugConfigFolder(cfg);
    const credentials = await config.getStoredCloudCredentials();
    if (!validateCredentials(credentials)) { return; }

    const debugConfig = await config.getDebugConfig(folder, credentials);
    const proxyLaunched = await vscode.commands.executeCommand<boolean>(launchDebugProxyCommandName, debugConfig);
    if (!proxyLaunched) {
      throw new Error("Failed to launch debug proxy", { cause: { folder: folder.uri.fsPath, debugConfig } });
    }
    return `http://127.0.0.1:${config.getProxyPort(folder)}`;
  } catch (e) {
    logger.error("getProxyUrl", e);
    vscode.window.showErrorMessage(`Failed to get proxy URL`);
  }
}
