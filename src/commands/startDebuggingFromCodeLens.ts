import * as vscode from 'vscode';
import { logger } from '../extension';
import type { DbosMethodInfo } from '../ProvenanceDatabase';
import { startDebugging, showWorkflowPick } from '../userFlows';

export const startDebuggingCodeLensCommandName = "dbos-ttdbg.start-debugging-code-lens";
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
