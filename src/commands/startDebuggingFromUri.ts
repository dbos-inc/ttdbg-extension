import * as vscode from 'vscode';
import { logger } from '../extension';
import { getWorkspaceFolder } from '../utils';
import { startDebugging } from '../userFlows';


export const startDebuggingUriCommandName = "dbos-ttdbg.start-debugging-uri";
export async function startDebuggingFromUri(workflowID: string) {
  try {
    const folder = await getWorkspaceFolder();
    if (!folder) { return; }

    logger.info(`startDebuggingFromUri`, { folder: folder.uri.fsPath, workflowID });
    await startDebugging(folder, async () => { return workflowID; });
  } catch (e) {
    logger.error("startDebuggingFromUri", e);
    vscode.window.showErrorMessage(`Failed to debug ${workflowID} workflow`);
  }
}
