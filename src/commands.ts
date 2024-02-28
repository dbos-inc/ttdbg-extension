import * as vscode from 'vscode';
import { logger, config, provDB, debugProxy } from './extension';
import { DbosMethodType } from "./sourceParser";
import { getWorkspaceFolder, isQuickPickItem, showQuickPick } from './utils';
import { dbos_cloud_login } from './cloudCli';
import { ClientConfig } from 'pg';

export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
export const startDebuggingCodeLensCommandName = "dbos-ttdbg.start-debugging-code-lens";
export const startDebuggingUriCommandName = "dbos-ttdbg.start-debugging-uri";
export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export const deleteProvDbPasswordsCommandName = "dbos-ttdbg.delete-prov-db-passwords";

async function startDebugging(folder: vscode.WorkspaceFolder, getWorkflowID: (clientConfig: ClientConfig) => Promise<string | undefined>) {
    try {
        const clientConfig = await config.getProvDbConfig(folder);
        if (!clientConfig) { return; }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: "Launching DBOS Time Travel Debugger",
            },
            async () => {
                await debugProxy.launch(clientConfig);
                const workflowID = await getWorkflowID(clientConfig);
                if (!workflowID) { return; }

                const workflowStatus = await provDB.getWorkflowStatus(clientConfig, workflowID);
                if (!workflowStatus) {
                    vscode.window.showErrorMessage(`Workflow ID ${workflowID} not found`);
                    return;
                }

                const proxyURL = `http://localhost:${config.proxyPort ?? 2345}`;
                logger.info(`startDebugging`, { folder: folder.uri.fsPath, database: clientConfig.database, workflowID });
                const debuggerStarted = await vscode.debug.startDebugging(
                    folder,
                    {
                        name: `Time-Travel Debug ${workflowID}`,
                        type: 'node-terminal',
                        request: 'launch',
                        command: `npx dbos-sdk debug -x ${proxyURL} -u ${workflowID}`
                    }
                );

                if (!debuggerStarted) {
                    throw new Error("vscode.debug.startDebugging returned false");
                }
            }
        );
    } catch (e) {
        logger.error("startDebugging", e);
        vscode.window.showErrorMessage(`Failed to start debugging`);
    }
}

export async function startDebuggingFromCodeLens(folder: vscode.WorkspaceFolder, name: string, $type: DbosMethodType) {
    logger.info(`startDebuggingFromCodeLens`, { folder: folder.uri.fsPath, name, type: $type });
    await startDebugging(folder, async (clientConfig) => {
        const statuses = await provDB.getWorkflowStatuses(clientConfig, name, $type);
        const items = statuses.map(s => <vscode.QuickPickItem>{
            label: new Date(parseInt(s.created_at)).toLocaleString(),
            description: `${s.authenticated_user.length === 0 ? "<anonymous>" : s.authenticated_user} (${s.status})`,
            detail: s.workflow_uuid,
        });

        const editButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon("edit"),
            tooltip: "Specify workflow id directly"
        };

        // TODO: add dashboard launch support
        // const dashboardButton: vscode.QuickInputButton = {
        //     iconPath: new vscode.ThemeIcon("server"),
        //     tooltip: "Select workflow via DBOS User Dashboard"
        // };

        const pickResult = await showQuickPick({
            buttons : [editButton],
            items,
            canSelectMany: false,
            title: "Select a workflow ID to debug"
        });
        if (pickResult === undefined) { return undefined; }
        if (isQuickPickItem(pickResult)) {
            return pickResult.detail;
        }
        if (pickResult === editButton) {
            return await vscode.window.showInputBox({ prompt: "Enter the workflow ID" });
        } else {
            throw new Error(`Unexpected button: ${pickResult.tooltip ?? "<unknown>"}`);
        }
    });
}

export async function startDebuggingFromUri(wfid: string) {
    const folder = await getWorkspaceFolder();
    if (!folder) { return; }

    logger.info(`startDebuggingFromUri`, { folder: folder.uri.fsPath, wfid });
    await startDebugging(folder, async () => { return wfid; });
}

export function shutdownDebugProxy() {
    try {
        debugProxy.shutdown();
    } catch (e) {
        logger.error("shutdownDebugProxy", e);
    }
}

export async function deleteProvenanceDatabasePasswords() {
    try {
        await config.deletePasswords();
    } catch (e) {
        logger.error("deleteProvenanceDatabasePasswords", e);
    }
}

export async function cloudLogin() {
    try {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 1) {
            await dbos_cloud_login(folders[0]);
        } else {
            throw new Error("This command only works when exactly one workspace folder is open");
        }
    } catch (e) {
        logger.error("cloudLogin", e);
    }
}