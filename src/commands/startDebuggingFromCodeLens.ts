import * as vscode from 'vscode';
import { logger } from '../extension';
import { startDebugging } from '../startDebugging';
import { showWorkflowPick } from '../showWorkflowPick';
import type { DbosMethodInfo } from '../CodeLensProvider';

export async function startDebuggingFromCodeLens(folder: vscode.WorkspaceFolder, method: DbosMethodInfo) {
  try {
    logger.info(`startDebuggingFromCodeLens`, { folder: folder.uri.fsPath, method });
    await startDebugging(folder, async (cloudConfig) => {
      return await showWorkflowPick(folder, { cloudConfig, method });
    });
  } catch (e) {
    logger.error("startDebuggingFromCodeLens", e);
    vscode.window.showErrorMessage(`Failed to debug ${method.name} method`);
  }
}
