import * as vscode from 'vscode';
import { logger } from './extension';
import type { DbosDebugConfig } from './Configuration';
import { validateCredentials } from './validateCredentials';
// import type { DbosMethodInfo } from './CodeLensProvider';
// import { getWorkflowStatuses } from './provenanceDb';
// import { launchDashboardCommandName } from './commands';

// export async function showWorkflowPick(
//   folder: vscode.WorkspaceFolder,
//   options?: {
//     method?: DbosMethodInfo;
//     cloudConfig?: DbosDebugConfig;
//   }
// ): Promise<string | undefined> {
//   return undefined;
  // let cloudConfig = options?.cloudConfig;
  // if (!cloudConfig) {
  //   const credentials = await config.getStoredCloudCredentials();
  //   if (!validateCredentials(credentials)) {
  //     logger.warn("showWorkflowPick: config.getStoredCloudCredentials returned undefined");
  //     return undefined;
  //   }
  //   cloudConfig = await config.getDebugConfig(folder, credentials);
  // }

  // const statuses = await getWorkflowStatuses(cloudConfig, options?.method);
  // const items = statuses.map(status => <vscode.QuickPickItem>{
  //   label: new Date(parseInt(status.created_at)).toLocaleString(),
  //   description: `${status.status}${status.authenticated_user.length !== 0 ? ` (${status.authenticated_user})` : ""}`,
  //   detail: status.workflow_uuid,
  // });

  // const editButton: vscode.QuickInputButton = {
  //   iconPath: new vscode.ThemeIcon("edit"),
  //   tooltip: "Specify workflow id directly"
  // };

  // const dashboardButton: vscode.QuickInputButton = {
  //   iconPath: new vscode.ThemeIcon("server"),
  //   tooltip: "Select workflow via DBOS User Dashboard"
  // };

  // const disposables: { dispose(): any; }[] = [];
  // try {
  //   const result = await new Promise<vscode.QuickInputButton | vscode.QuickPickItem | undefined>(resolve => {
  //     const input = vscode.window.createQuickPick();
  //     input.title = "Select a workflow ID to debug";
  //     input.canSelectMany = false;
  //     input.items = items;
  //     input.buttons = [editButton, dashboardButton];
  //     let selectedItem: vscode.QuickPickItem | undefined = undefined;
  //     disposables.push(
  //       input.onDidAccept(() => {
  //         logger.debug("showWorkflowPick.onDidAccept", { selectedItem });
  //         resolve(selectedItem);
  //         input.dispose();
  //       }),
  //       input.onDidHide(() => {
  //         logger.debug("showWorkflowPick.onDidHide", { selectedItem });
  //         resolve(undefined);
  //         input.dispose();
  //       }),
  //       input.onDidChangeSelection(items => {
  //         logger.debug("showWorkflowPick.onDidChangeSelection", { items });
  //         selectedItem = items.length === 0 ? undefined : items[0];
  //       }),
  //       input.onDidTriggerButton(button => {
  //         logger.debug("showWorkflowPick.onDidTriggerButton", { button });
  //         resolve(button);
  //         input.dispose();
  //       })
  //     );
  //     input.show();
  //   });
  //   if (result === undefined) { return undefined; }
  //   if ("label" in result) {
  //     return result.detail;
  //   }
  //   if (result === editButton) {
  //     return await vscode.window.showInputBox({ prompt: "Enter the workflow ID" });
  //   } else if (result === dashboardButton) {
  //     vscode.commands.executeCommand(launchDashboardCommandName, cloudConfig.appName, options?.method)
  //       .then(undefined, e => logger.error(launchDashboardCommandName, e));
  //     return undefined;
  //   } else {
  //     throw new Error(`Unexpected button: ${result.tooltip ?? "<unknown>"}`);
  //   }
  // } finally {
  //   disposables.forEach(d => d.dispose());
  // }
// }
