import * as vscode from 'vscode';
import { execFile as cpExecFile } from "child_process";
import util from 'util';
import { fast1a32 } from 'fnv-plus';
import { ClientConfig } from 'pg';
import { DbosDebugConfig } from './configuration';
import { logger } from './extension';

export const PLATFORM = function () {
  switch (process.platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}();

export const ARCHITECTURE = function () {
  switch (process.arch) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x64";
    default:
      throw new Error(`Unsupported architecture: ${process.arch}`);
  }
}();

export function stringify(obj: unknown): string {
  if (typeof obj === 'string') { return obj; }
  if (obj instanceof Error) { return obj.message; }
  if (typeof obj === 'object') { return JSON.stringify(obj); }
  return (obj as any).toString();
}

export async function exists(uri: vscode.Uri): Promise<boolean> {
  return await vscode.workspace.fs.stat(uri)
    .then(_value => true, () => false);
}

export async function getPackageName(folder: vscode.WorkspaceFolder): Promise<string | undefined> {
  const packageJsonUri = vscode.Uri.joinPath(folder.uri, "package.json");
  if (!await exists(packageJsonUri)) { return undefined; }

  try {
    const packageJsonBuffer = await vscode.workspace.fs.readFile(packageJsonUri);
    const packageJsonText = new TextDecoder().decode(packageJsonBuffer);
    const packageJson = JSON.parse(packageJsonText);
    return packageJson.name;
  } catch (e) {
    logger.error("getPackageName", e);
    return undefined;
  }
}

export const execFile = util.promisify(cpExecFile);

export function hashClientConfig(clientConfig: ClientConfig | DbosDebugConfig) {
  const { host, port, database, user } = clientConfig;
  return host && port && database && user
    ? fast1a32(`${host}:${port}:${database}:${user}`)
    : undefined;
}

export async function getWorkspaceFolder(rootPath?: string | vscode.Uri) {
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

export function getDebugConfigFolder(cfg?: vscode.DebugConfiguration): vscode.WorkspaceFolder {
  const rootPath = cfg?.rootPath;
  if (!rootPath) { throw new Error("getDebugConfigFolder: Invalid rootPath", { cause: cfg }); }
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(rootPath));
  if (!folder) { throw new Error("getDebugConfigFolder: getWorkspaceFolder failed", { cause: cfg }); }
  return folder;
}

export async function cancellableFetch(url: string, request: Omit<RequestInit, 'signal'>, token?: vscode.CancellationToken) {
  const abort = new AbortController();
  const tokenListener = token?.onCancellationRequested(reason => { abort.abort(reason); });
  try {
    return await fetch(url, { ...request, signal: abort.signal });
  } finally {
    tokenListener?.dispose();
  }
}
