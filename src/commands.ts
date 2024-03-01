import * as vscode from 'vscode';
import { logger, config, provDB, debugProxy } from './extension';
import { DbosMethodType } from "./sourceParser";
import { exists, getWorkspaceFolder, isQuickPickItem, showQuickPick } from './utils';
import { dbos_cloud_dashboard_launch, dbos_cloud_dashboard_url, dbos_cloud_login } from './cloudCli';
import { CloudConfig } from './configuration';

export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
export const startDebuggingCodeLensCommandName = "dbos-ttdbg.start-debugging-code-lens";
export const startDebuggingUriCommandName = "dbos-ttdbg.start-debugging-uri";
export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export const deleteProvDbPasswordsCommandName = "dbos-ttdbg.delete-prov-db-passwords";

async function startDebugging(folder: vscode.WorkspaceFolder, getWorkflowID: (cloudConfig: CloudConfig) => Promise<string | undefined>) {
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: "Launching DBOS Time Travel Debugger",
            },
            async () => {
                const cloudConfig = await config.getCloudConfig(folder);
                if (!cloudConfig) { 
                    logger.warn("startDebugging: config.getProvDBConfig returned undefined");
                    return; 
                }
               
                const workflowID = await getWorkflowID(cloudConfig);
                if (!workflowID) { 
                    logger.warn("startDebugging: getWorkflowID returned undefined");
                    return; 
                }

                const workflowStatus = await provDB.getWorkflowStatus(cloudConfig, workflowID);
                if (!workflowStatus) {
                    vscode.window.showErrorMessage(`Workflow ID ${workflowID} not found`);
                    return;
                }

                const proxyLaunched = await debugProxy.launch(cloudConfig);
                if (!proxyLaunched) { 
                    logger.warn("startDebugging: debugProxy.launch returned false");
                    return; 
                }
                
                const proxyURL = `http://localhost:${config.proxyPort ?? 2345}`;
                const preLaunchTask = config.preLaunchTask;
                logger.info(`startDebugging`, { folder: folder.uri.fsPath, database: cloudConfig.database, preLaunchTask, workflowID });
                const debuggerStarted = await vscode.debug.startDebugging(
                    folder,
                    {
                        name: `Time-Travel Debug ${workflowID}`,
                        type: 'node-terminal',
                        request: 'launch',
                        command: `npx dbos-sdk debug -x ${proxyURL} -u ${workflowID}`,
                        preLaunchTask,
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

export async function startDebuggingFromCodeLens(folder: vscode.WorkspaceFolder, methodName: string, $type: DbosMethodType) {
    logger.info(`startDebuggingFromCodeLens`, { folder: folder.uri.fsPath, name: methodName, type: $type });
    await startDebugging(folder, async (cloudConfig) => {
        const statuses = await provDB.getWorkflowStatuses(cloudConfig, methodName, $type);
        const items = statuses.map(s => <vscode.QuickPickItem>{
            label: new Date(parseInt(s.created_at)).toLocaleString(),
            description: `${s.status}${s.authenticated_user.length !== 0 ? ` (${s.authenticated_user})` : ""}`,
            detail: s.workflow_uuid,
        });

        const editButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon("edit"),
            tooltip: "Specify workflow id directly"
        };

        const dashboardButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon("server"),
            tooltip: "Select workflow via DBOS User Dashboard"
        };

        const pickResult = await showQuickPick({
            buttons : [editButton, dashboardButton],
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
        } else if (pickResult === dashboardButton) {
            startOpenDashboardFlow(folder, cloudConfig.appName, methodName, $type)
                .catch(e => logger.error("startOpenDashboard", e));
            return undefined;
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

async function startOpenDashboardFlow(folder: vscode.WorkspaceFolder, appName: string | undefined, methodName: string, methodType: DbosMethodType): Promise<void> {
    const dashboardUrl = await dbos_cloud_dashboard_url(folder);
    logger.debug(`startOpenDashboardFlow enter`, { folder: folder.uri.fsPath, appName: appName ?? null, methodName, methodType, dashboardUrl: dashboardUrl ?? null });

    if (!dashboardUrl) {
        const dashboardLaunchUrl = await dbos_cloud_dashboard_launch(folder);
        logger.debug(`startOpenDashboardFlow dbos_cloud_dashboard_launch`, { dashboardLaunchUrl });

        if (!dashboardLaunchUrl) {
            var error = new Error("Failed to get dashboard URL");
            vscode.window.showErrorMessage(error.message);
            throw error;
        }

        const response = await vscode.window.showWarningMessage("Please login to create your DBOS Dashboard", "Login", "Cancel");
        if (response === "Login") {
            logger.info(`startOpenDashboardFlow launch`, { uri: dashboardLaunchUrl });
            const openResult = await vscode.env.openExternal(vscode.Uri.parse(dashboardLaunchUrl));
            if (!openResult) { 
                throw new Error(`failed to open dashboard launch URL: ${dashboardLaunchUrl}`); 
            }
        }
    } else {
        let query = `var-operation_name=${methodName}&var-operation_type=${methodType.toLowerCase()}`;
        if (appName) { query += `&var-app_name=${appName}`; }
        const dashboardQueryUrl = `${dashboardUrl}?${query}`;
        logger.info(`startOpenDashboardFlow uri`, { uri: dashboardQueryUrl });
        const openResult = await vscode.env.openExternal(vscode.Uri.parse(dashboardQueryUrl));
        if (!openResult) {
            throw new Error(`failed to open dashboard URL: ${dashboardQueryUrl}`); 
        }
    }
}

export async function startInvalidCredentialsFlow(folder: vscode.WorkspaceFolder): Promise<void> {
    const credentialsPath = vscode.Uri.joinPath(folder.uri, ".dbos", "credentials");
    const credentialsExists = await exists(credentialsPath);

    const message = credentialsExists
        ? "DBOS Cloud credentials have expired. Please login again."
        : "You need to login to DBOS Cloud.";

    const items = ["Login", "Cancel"];

    // TODO: Register support
    // if (!credentialsExists) { items.unshift("Register"); }

    const result = await vscode.window.showWarningMessage(message, ...items);
    switch (result) {
        // case "Register": break;
        case "Login":
            await dbos_cloud_login(folder);
            break;
    }
}