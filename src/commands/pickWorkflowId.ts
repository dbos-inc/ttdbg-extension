import * as vscode from 'vscode';
import { logger } from '../extension';
import { getDebugConfigFolder } from '../utility';
// import { showWorkflowPick } from '../showWorkflowPick';
import { validateCredentials } from '../validateCredentials';

export async function pickWorkflowId(cfg?: vscode.DebugConfiguration) {
  try {
    const folder = getDebugConfigFolder(cfg);
    // const credentials = await config.getStoredCloudCredentials();
    // if (!validateCredentials(credentials)) { return undefined; }
    // const cloudConfig = await config.getDebugConfig(folder, credentials);

    // return await showWorkflowPick(folder, { cloudConfig });
  } catch (e) {
    logger.error("pickWorkflowId", e);
    vscode.window.showErrorMessage("Failed to get workflow ID");
  }
}
