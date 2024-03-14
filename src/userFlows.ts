import * as vscode from 'vscode';
import { logger, config, provDB, debugProxy } from './extension';
import { exists } from './utils';
import { CloudConfig } from './configuration';
import { DbosMethodInfo } from './ProvenanceDatabase';

export async function startDebugging(folder: vscode.WorkspaceFolder, getWorkflowID: (cloudConfig: CloudConfig) => Promise<string | undefined>) {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Window,
            title: "Launching DBOS Time Travel Debugger",
        },
        async () => {
            const cloudConfig = await config.getCloudConfig(folder);
            if (!cloudConfig) {
                logger.warn("startDebugging: config.getCloudConfig returned undefined", { folder: folder.uri.fsPath });
                return undefined;
            }

            const workflowID = await getWorkflowID(cloudConfig);
            if (!workflowID) {
                logger.warn("startDebugging: getWorkflowID returned undefined", { folder: folder.uri.fsPath, cloudConfig });
                return undefined;
            }

            const workflowStatus = await provDB.getWorkflowStatus(cloudConfig, workflowID);
            if (!workflowStatus) {
                logger.error(`startDebugging: Workflow ID ${workflowID} not found`, { folder: folder.uri.fsPath, cloudConfig });
                vscode.window.showErrorMessage(`Workflow ID ${workflowID} not found`);
                return undefined;
            }

            const proxyLaunched = await debugProxy.launch(cloudConfig, folder);
            if (!proxyLaunched) {
                logger.warn("startDebugging: debugProxy.launch returned false", { folder: folder.uri.fsPath, cloudConfig, workflowID });
                return undefined;
            }

            const debugConfig = config.getDebugConfig(folder, workflowID);
            logger.info(`startDebugging`, { folder: folder.uri.fsPath, database: cloudConfig, debugConfig });

            const debuggerStarted = await vscode.debug.startDebugging(folder, debugConfig);
            if (!debuggerStarted) {
                throw new Error("startDebugging: Debugger failed to start", {
                    cause: {
                        folder: folder.uri.fsPath,
                        cloudConfig,
                        workflowID,
                        debugConfig,
                    }
                });
            }
        });
}

export async function showWorkflowPick(
    folder: vscode.WorkspaceFolder,
    options?: {
        method?: DbosMethodInfo;
        cloudConfig?: CloudConfig;
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

    const disposables: { dispose(): any; }[] = [];
    try {
        const result = await new Promise<vscode.QuickInputButton | vscode.QuickPickItem | undefined>(resolve => {
            const input = vscode.window.createQuickPick();
            input.title = "Select a workflow ID to debug";
            input.canSelectMany = false;
            input.items = items;
            input.buttons = [editButton, dashboardButton];
            disposables.push(
                input.onDidTriggerButton(item => { resolve(item); input.hide(); }),
                input.onDidHide(() => { resolve(undefined); input.dispose(); }),
                input.onDidChangeSelection(() => {
                    const item = items[0];
                    if (item) {
                        resolve(item);
                        input.hide();
                    }
                })
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
    // const dashboardUrl = await dbos_cloud_dashboard_url(folder);
    // logger.debug(`startOpenDashboardFlow enter`, { folder: folder.uri.fsPath, appName: appName ?? null, method, dashboardUrl: dashboardUrl ?? null });
    // if (!dashboardUrl) {
    //     const dashboardLaunchUrl = await dbos_cloud_dashboard_launch(folder);
    //     logger.debug(`startOpenDashboardFlow dbos_cloud_dashboard_launch`, { dashboardLaunchUrl });
    //     if (!dashboardLaunchUrl) {
    //         var error = new Error("Failed to get dashboard URL");
    //         vscode.window.showErrorMessage(error.message);
    //         throw error;
    //     }
    //     const response = await vscode.window.showWarningMessage("Please login to create your DBOS Dashboard", "Login", "Cancel");
    //     if (response === "Login") {
    //         logger.info(`startOpenDashboardFlow launch`, { uri: dashboardLaunchUrl });
    //         const openResult = await vscode.env.openExternal(vscode.Uri.parse(dashboardLaunchUrl));
    //         if (!openResult) {
    //             throw new Error(`failed to open dashboard launch URL: ${dashboardLaunchUrl}`);
    //         }
    //     }
    // } else {
    //     let query = "";
    //     if (method) {
    //         query += `var-operation_name=${method.name}&var-operation_type=${method.type.toLowerCase()}`;
    //     }
    //     if (appName) {
    //         query += `&var-app_name=${appName}`;
    //     }
    //     const dashboardQueryUrl = `${dashboardUrl}?${query}`;
    //     logger.info(`startOpenDashboardFlow uri`, { uri: dashboardQueryUrl });
    //     const openResult = await vscode.env.openExternal(vscode.Uri.parse(dashboardQueryUrl));
    //     if (!openResult) {
    //         throw new Error(`failed to open dashboard URL: ${dashboardQueryUrl}`);
    //     }
    // }
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
            // await config.authenticate();
            break;
    }
}
