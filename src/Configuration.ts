import * as vscode from 'vscode';

const TTDBG_CONFIG_SECTION = "dbos-ttdbg";
const DEBUG_PROXY_PORT = "debug_proxy_port";
const DEBUG_PROXY_PATH = "debug_proxy_path";
const DEBUG_PROXY_PRERELEASE = "debug_proxy_prerelease";

export class Configuration {

    static getProxyPath(folder?: vscode.WorkspaceFolder) {
        const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
        const proxyPath = cfg.get<string>(DEBUG_PROXY_PATH);
        return proxyPath ? vscode.Uri.file(proxyPath) : undefined;
    }

    static getProxyPrerelease(folder?: vscode.WorkspaceFolder) {
        const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
        return cfg.get<boolean>(DEBUG_PROXY_PRERELEASE) ?? false;
    }

    static getProxyPort(folder?: vscode.WorkspaceFolder): number {
        const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
        return cfg.get<number>(DEBUG_PROXY_PORT, 2345);
    }
}
