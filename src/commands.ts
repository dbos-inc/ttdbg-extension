import * as vscode from 'vscode';
import { logger, config, provDB, debugProxy } from './extension';
import { exists, getWorkspaceFolder } from './utils';
import { dbos_cloud_dashboard_launch, dbos_cloud_dashboard_url, dbos_cloud_login } from './cloudCli';
import { CloudConfig } from './configuration';
import { DbosMethodInfo } from './ProvenanceDatabase';

interface LaunchConfig {
    // actual launch configs have more fields, but this extension only uses rootPath
    rootPath: string;
}

export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
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
    try {
        await config.deletePasswords();
    } catch (e) {
        logger.error("deleteProvenanceDatabasePasswords", e);
    }
}

export const getProxyUrlCommandName = "dbos-ttdbg.get-proxy-url";
export async function getProxyUrl(cfg?: LaunchConfig) {
    try {
        const folder = await getWorkspaceFolder(cfg?.rootPath);
        if (!folder) {
            throw new Error("Invalid workspace folder");
        }

        const port = config.getProxyPort(folder);
        return `http://localhost:${port}`;
    } catch (e) {
        logger.error("getProxyUrl", e);
        throw e;
    }
}

export const pickWorkflowIdCommandName = "dbos-ttdbg.pick-workflow-id";
export async function pickWorkflowId(cfg?: LaunchConfig) {
    const folder = await getWorkspaceFolder(cfg?.rootPath);
    if (!folder) {
        return;
    }

    const cloudConfig = await config.getCloudConfig(folder);
    if (cloudConfig) {
        await debugProxy.launch(cloudConfig);
    }

    return await showWorkflowPick(folder, { cloudConfig });
}

export const startDebuggingUriCommandName = "dbos-ttdbg.start-debugging-uri";
export async function startDebuggingFromUri(wfid: string) {
    try {
        const folder = await getWorkspaceFolder();
        if (!folder) { return; }

        logger.info(`startDebuggingFromUri`, { folder: folder.uri.fsPath, wfid });
        await startDebugging(folder, async () => { return wfid; });
    } catch (e) {
        logger.error("startDebuggingFromUri", e);
        throw e;
    }
}

export const startDebuggingCodeLensCommandName = "dbos-ttdbg.start-debugging-code-lens";
export async function startDebuggingFromCodeLens(folder: vscode.WorkspaceFolder, method: DbosMethodInfo) {
    logger.info(`startDebuggingFromCodeLens`, { folder: folder.uri.fsPath, method });
    await startDebugging(folder, async (cloudConfig) => {
        return await showWorkflowPick(folder, { cloudConfig, method });
    });
}

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

                const proxyPort = config.getProxyPort(folder);
                const preLaunchTask = config.getPreLaunchTask(folder);
                logger.info(`startDebugging`, { folder: folder.uri.fsPath, database: cloudConfig.database, preLaunchTask, workflowID });

                const debuggerStarted = await vscode.debug.startDebugging(
                    folder,
                    {
                        name: `Time-Travel Debug ${workflowID}`,
                        type: 'node-terminal',
                        request: 'launch',
                        command: `npx dbos-sdk debug -x http://localhost:${proxyPort} -u ${workflowID}`,
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

async function showWorkflowPick(
    folder: vscode.WorkspaceFolder,
    options?: {
        method?: DbosMethodInfo,
        cloudConfig?: CloudConfig,
        showDashboardButton?: boolean,
    }
): Promise<string | undefined> {
    const cloudConfig = options?.cloudConfig ?? await config.getCloudConfig(folder);
    if (!cloudConfig) {
        logger.warn("pickWorkflow: config.getCloudConfig returned undefined");
        return undefined;
    }

    const statuses = await provDB.getWorkflowStatuses(cloudConfig, options?.method);
    const items = statuses.map(status => <vscode.QuickPickItem>{
        label: new Date(parseInt(status.created_at)).toLocaleString(),
        description: `${status.status}${status.authenticated_user.length !== 0 ? ` (${status.authenticated_user})` : ""}`,
        detail: status.workflow_uuid,
    });

    const editButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon("edit"),
        tooltip: "Specify workflow id directly"
    };

    const dashboardButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon("server"),
        tooltip: "Select workflow via DBOS User Dashboard"
    };

    const buttons = options?.showDashboardButton ?? false ? [editButton, dashboardButton] : [editButton];
    const disposables: { dispose(): any }[] = [];
    try {
        const result = await new Promise<vscode.QuickInputButton | vscode.QuickPickItem | undefined>(resolve => {
            const input = vscode.window.createQuickPick();
            input.title = "Select a workflow ID to debug";
            input.canSelectMany =  false;
            input.items = items;
            input.buttons = buttons;
            disposables.push(
                input.onDidTriggerButton(item => { resolve(item); input.hide(); }),
                input.onDidHide(() => { resolve(undefined); input.dispose(); }),
                input.onDidChangeSelection(() => {
                    const item = items[0];
                    if (item) {
                        resolve(item);
                        input.hide();
                    }
                }),
            );
            input.show();
        });
        if (result === undefined) { return undefined; }
        if ("label" in result) {
            return result.detail;
        }
        if (result === editButton) {
            return await vscode.window.showInputBox({ prompt: "Enter the workflow ID" });
        } else if (result === dashboardButton) {
            startOpenDashboardFlow(folder, cloudConfig.appName, options?.method)
                .catch(e => logger.error("startOpenDashboard", e));
            return undefined;
        } else {
            throw new Error(`Unexpected button: ${result.tooltip ?? "<unknown>"}`);
        }
    } finally {
        disposables.forEach(d => d.dispose());
    }
}

async function startOpenDashboardFlow(folder: vscode.WorkspaceFolder, appName: string | undefined, method?: DbosMethodInfo): Promise<void> {
    const dashboardUrl = await dbos_cloud_dashboard_url(folder);
    logger.debug(`startOpenDashboardFlow enter`, { folder: folder.uri.fsPath, appName: appName ?? null, method, dashboardUrl: dashboardUrl ?? null });

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
        let query = "";
        if (method) {
            query += `var-operation_name=${method.name}&var-operation_type=${method.type.toLowerCase()}`;
        }
        if (appName) {
            query += `&var-app_name=${appName}`;
        }
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