import * as vscode from 'vscode';
import { logger, debugProxy, config } from './extension';
import { getWorkspaceFolder } from './utils';
import { DbosMethodInfo } from './ProvenanceDatabase';
import { startDebugging, showWorkflowPick } from './userFlows';

export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
export async function cloudLogin() {
    throw new Error("cloudLogin stubbed out");
    // try {
    //     await config.authenticate();
    // } catch (e) {
    //     logger.error("cloudLogin", e);
    // }
}

export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export function shutdownDebugProxy() {
    try {
        debugProxy.shutdown();
    } catch (e) {
        logger.error("shutdownDebugProxy", e);
    }
}

export const deleteProvenanceDatabasePasswordsCommandName = "dbos-ttdbg.delete-prov-db-passwords";
export async function deleteProvenanceDatabasePasswords() {
    throw new Error("deleteProvenanceDatabasePasswords stubbed out");

    // try {
    //     await config.deletePasswords();
    // } catch (e) {
    //     logger.error("deleteProvenanceDatabasePasswords", e);
    // }
}

export const getProxyUrlCommandName = "dbos-ttdbg.get-proxy-url";
export async function getProxyUrl(cfg?: vscode.DebugConfiguration) {
    try {
        const folder = await getWorkspaceFolder(cfg?.rootPath);
        if (!folder) {
            throw new Error("Invalid workspace folder", { cause: cfg?.rootPath });
        }

        const cloudConfig = await config.getCloudConfig(folder);
        if (!cloudConfig) {
            throw new Error(`Failed to get cloud config`, { cause: folder.uri.fsPath });
        }

        const proxyLaunched = await debugProxy.launch(cloudConfig, folder);
        if (!proxyLaunched) {
            throw new Error("Failed to launch debug proxy", { cause: cloudConfig });
        }

        return `http://localhost:${config.getProxyPort(folder)}`;
    } catch (e) {
        logger.error("getProxyUrl", e);
        vscode.window.showErrorMessage(`Failed to get proxy URL`);
    }
}

export const pickWorkflowIdCommandName = "dbos-ttdbg.pick-workflow-id";
export async function pickWorkflowId(cfg?: vscode.DebugConfiguration) {
    try {
        const folder = await getWorkspaceFolder(cfg?.rootPath);
        if (!folder) { return undefined; }

        const cloudConfig = await config.getCloudConfig(folder);
        if (!cloudConfig) {
            throw new Error(`Failed to get cloud config`, { cause: folder.uri.fsPath });
        }

        const proxyLaunched = await debugProxy.launch(cloudConfig, folder);
        if (!proxyLaunched) {
            throw new Error("Failed to launch debug proxy", { cause: cloudConfig });
        }

        return await showWorkflowPick(folder, { cloudConfig });
    } catch (e) {
        logger.error("pickWorkflowId", e);
        vscode.window.showErrorMessage("Failed to get workflow ID");
    }
}

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

