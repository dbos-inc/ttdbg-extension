import * as vscode from 'vscode';
import { logger, config } from '../extension';
import { getDebugConfigFolder } from '../utils';
import { showWorkflowPick, validateCredentials } from '../userFlows';

export async function pickWorkflowId(cfg?: vscode.DebugConfiguration) {
  try {
    const folder = getDebugConfigFolder(cfg);
    const credentials = await config.getStoredCloudCredentials();
    if (!validateCredentials(credentials)) { return undefined; }
    const cloudConfig = await config.getDebugConfig(folder, credentials);

    return await showWorkflowPick(folder, { cloudConfig });
  } catch (e) {
    logger.error("pickWorkflowId", e);
    vscode.window.showErrorMessage("Failed to get workflow ID");
  }
}
