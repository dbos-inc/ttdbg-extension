import * as vscode from 'vscode';

export async function exists(uri: vscode.Uri): Promise<boolean> {
  return await vscode.workspace.fs.stat(uri)
    .then(_value => true, () => false);
}

export function getDebugConfigFolder(cfg?: vscode.DebugConfiguration): vscode.WorkspaceFolder {
  const rootPath = cfg?.rootPath;
  if (!rootPath) { throw new Error("getDebugConfigFolder: Invalid rootPath", { cause: cfg }); }
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(rootPath));
  if (!folder) { throw new Error("getDebugConfigFolder: getWorkspaceFolder failed", { cause: cfg }); }
  return folder;
}
