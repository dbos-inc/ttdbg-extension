import * as vscode from 'vscode';
import { logger, config, provDB, debugProxy } from './extension';
import { CloudConfig } from './configuration';
import { DbosMethodInfo } from './ProvenanceDatabase';
import { DbosCloudCredentials, createDashboard, getDashboard, isTokenExpired } from './dbosCloudApi';

export async function startDebugging(folder: vscode.WorkspaceFolder, getWorkflowID: (cloudConfig: CloudConfig) => Promise<string | undefined>) {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Window,
            title: "Launching DBOS Time Travel Debugger",
        },
        async () => {
            const credentials = await config.getStoredCloudCredentials();
            if (!validateCredentials(credentials)) {
                logger.warn("startDebugging: getWorkflowID returned invalid credentials", { folder: folder.uri.fsPath, credentials: credentials ?? null });
                return undefined;
            }

            const cloudConfig = await config.getCloudConfig(folder, credentials);
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
    let cloudConfig = options?.cloudConfig;
    if (!cloudConfig) {
        const credentials = await config.getStoredCloudCredentials();
        if (!validateCredentials(credentials)) {
            logger.warn("showWorkflowPick: config.getStoredCloudCredentials returned undefined");
            return undefined;
        }
        cloudConfig = await config.getCloudConfig(folder, credentials);
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
            let selectedItem: vscode.QuickPickItem | undefined = undefined;
            disposables.push(
                input.onDidAccept(() => { 
                    logger.debug("showWorkflowPick.onDidAccept", { selectedItem });
                    resolve(selectedItem); 
                    input.dispose(); 
                }),
                input.onDidHide(() => { 
                    logger.debug("showWorkflowPick.onDidHide", { selectedItem });
                    resolve(undefined); 
                    input.dispose(); 
                }),
                input.onDidChangeSelection(items => {
                    logger.debug("showWorkflowPick.onDidChangeSelection", { items });
                    selectedItem = items.length === 0 ? undefined : items[0];
                }),
                input.onDidTriggerButton(button => { 
                    logger.debug("showWorkflowPick.onDidTriggerButton", { button });
                    resolve(button); 
                    input.dispose(); 
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
            startOpenDashboardFlow(cloudConfig.appName, options?.method)
                .catch(e => logger.error("startOpenDashboard", e));
            return undefined;
        } else {
            throw new Error(`Unexpected button: ${result.tooltip ?? "<unknown>"}`);
        }
    } finally {
        disposables.forEach(d => d.dispose());
    }
}

async function startOpenDashboardFlow(appName: string | undefined, method?: DbosMethodInfo): Promise<void> {
    logger.debug(`startOpenDashboardFlow enter`, { appName: appName ?? null, method: method ?? null });
    const credentials = await config.getStoredCloudCredentials();
    if (!validateCredentials(credentials)) {
        logger.warn("startOpenDashboardFlow: config.getStoredCloudCredentials returned invalid credentials", { credentials });
        return undefined;
    }

    let dashboardUrl = await getDashboard(credentials);
    if (!dashboardUrl) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            cancellable: false,
            title: "Creating DBOS dashboard"
        }, async () => { await createDashboard(credentials); });

        dashboardUrl = await getDashboard(credentials);
        if (!dashboardUrl) { 
            vscode.window.showErrorMessage("Failed to create DBOS dashboard");
            return;
        }
    }

    const params = new URLSearchParams();
    if (method) {
        params.append("var-operation_name", method.name);
        params.append("var-operation_type", method.type.toLowerCase());
    }
    if (appName) {
        params.append("var-app_name", appName);
    }
    const dashboardQueryUrl = `${dashboardUrl}?${params}`;
    logger.info(`startOpenDashboardFlow uri`, { uri: dashboardQueryUrl });
    const openResult = await vscode.env.openExternal(vscode.Uri.parse(dashboardQueryUrl));
    if (!openResult) {
        throw new Error(`failed to open dashboard URL: ${dashboardQueryUrl}`);
    }
}

export function validateCredentials(credentials?: DbosCloudCredentials): credentials is DbosCloudCredentials {
    if (!credentials) {
        startInvalidCredentialsFlow(credentials)
            .catch(e => logger.error("startInvalidCredentialsFlow", e));
        return false;
    }

    if (isTokenExpired(credentials.token)) {
        startInvalidCredentialsFlow(credentials)
            .catch(e => logger.error("startInvalidCredentialsFlow", e));
        return false;
    }

    return true;
}

export async function startInvalidCredentialsFlow(credentials?: DbosCloudCredentials): Promise<void> {
    const message = credentials
        ? "DBOS Cloud credentials have expired. Please login again."
        : "You need to login to DBOS Cloud.";

    const items = ["Login", "Cancel"];

    // TODO: Register support
    // if (!credentials) { items.unshift("Register"); }
    const result = await vscode.window.showWarningMessage(message, ...items);
    switch (result) {
        // case "Register": break;
        case "Login":
            await config.cloudLogin();
            break;
    }
}
