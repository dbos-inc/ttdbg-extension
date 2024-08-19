import * as vscode from 'vscode';
import { logger } from '../extension';
import { startDebugging } from '../startDebugging';
import { showWorkflowPick } from '../showWorkflowPick';
import type { DbosMethodInfo } from '../CodeLensProvider';

function isError(e: any): e is Error {
  return e instanceof Error;
}

export async function startDebuggingFromCodeLens(folder: vscode.WorkspaceFolder, method: DbosMethodInfo) {
  try {
    logger.info(`startDebuggingFromCodeLens`, { folder: folder.uri.fsPath, method });
    await startDebugging(folder, async (cloudConfig) => {
      return await showWorkflowPick(folder, { cloudConfig, method });
    });
  } catch (e) {
    logger.error("startDebuggingFromCodeLens", e);
    if (isError(e)) {
      vscode.window.showErrorMessage(`Failed to debug ${method.name} method: ${e.message}`);
    } else {
      vscode.window.showErrorMessage(`Failed to debug ${method.name} method`);
    }
  }
}
