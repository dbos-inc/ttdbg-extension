import * as vscode from 'vscode';
import { logger, config, provDB, debugProxy } from './extension';
import { DbosDebugConfig } from './configuration';
import { DbosMethodInfo } from './ProvenanceDatabase';
import { DbosCloudCredentials, createDashboard, getDashboard, isTokenExpired } from './dbosCloudApi';

function getDebugLaunchConfig(folder: vscode.WorkspaceFolder, workflowID: string): vscode.DebugConfiguration {
    const debugConfigs = vscode.workspace.getConfiguration("launch", folder).get('configurations') as ReadonlyArray<vscode.DebugConfiguration> | undefined;
    for (const config of debugConfigs ?? []) {
      const command = config["command"] as string | undefined;
      if (command && command.includes("npx dbos-sdk debug")) {
        const newCommand = command.replace("${command:dbos-ttdbg.pick-workflow-id}", `${workflowID}`);
        return { ...config, command: newCommand };
      }
    }

    const preLaunchTask = config.getPreLaunchTask(folder);
    const proxyPort = config.getProxyPort(folder);
    return <vscode.DebugConfiguration>{
      name: `Time-Travel Debug ${workflowID}`,
      type: 'node-terminal',
      request: 'launch',
      command: `npx dbos-sdk debug -x http://localhost:${proxyPort} -u ${workflowID}`,
      preLaunchTask,
    };
  }

export async function startDebugging(folder: vscode.WorkspaceFolder, getWorkflowID: (cloudConfig: DbosDebugConfig) => Promise<string | undefined>) {
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

            const cloudConfig = await config.getDebugConfig(folder, credentials);
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

            const launchConfig = getDebugLaunchConfig(folder, workflowID);
            logger.info(`startDebugging`, { folder: folder.uri.fsPath, database: cloudConfig, debugConfig: launchConfig });

            const debuggerStarted = await vscode.debug.startDebugging(folder, launchConfig);
            if (!debuggerStarted) {
                throw new Error("startDebugging: Debugger failed to start", {
                    cause: {
                        folder: folder.uri.fsPath,
                        cloudConfig,
                        workflowID,
                        launchConfig,
                    }
                });
            }
        });
}

export async function showWorkflowPick(
    folder: vscode.WorkspaceFolder,
    options?: {
        method?: DbosMethodInfo;
        cloudConfig?: DbosDebugConfig;
    }
): Promise<string | undefined> {
    let cloudConfig = options?.cloudConfig;
    if (!cloudConfig) {
        const credentials = await config.getStoredCloudCredentials();
        if (!validateCredentials(credentials)) {
            logger.warn("showWorkflowPick: config.getStoredCloudCredentials returned undefined");
            return undefined;
        }
        cloudConfig = await config.getDebugConfig(folder, credentials);
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
