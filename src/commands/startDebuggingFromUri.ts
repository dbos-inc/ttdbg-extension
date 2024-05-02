import * as vscode from 'vscode';
import { logger } from '../extension';
import { startDebugging } from '../startDebugging';

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

async function getWorkspaceFolder(rootPath?: string | vscode.Uri) {
  if (rootPath) {
    if (typeof rootPath === "string") {
      rootPath = vscode.Uri.file(rootPath);
    }
    const folder = vscode.workspace.getWorkspaceFolder(rootPath);
    if (folder) {
      return folder;
    }
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {
    return folders[0];
  }

  if (vscode.window.activeTextEditor) {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    if (folder) {
      return folder;
    }
  }

  return await vscode.window.showWorkspaceFolderPick();
}

