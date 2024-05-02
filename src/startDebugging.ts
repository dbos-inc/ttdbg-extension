import * as vscode from 'vscode';
import { logger, config } from './extension';
import type { DbosDebugConfig } from './configuration';
import { validateCredentials } from './validateCredentials';
import { getWorkflowStatus } from './getWorkflowStatuses';
import { launchDebugProxyCommandName } from './commands';

export async function startDebugging(folder: vscode.WorkspaceFolder, getWorkflowID: (debugConfig: DbosDebugConfig) => Promise<string | undefined>) {
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

      const debugConfig = await config.getDebugConfig(folder, credentials);
      const workflowID = await getWorkflowID(debugConfig);
      if (!workflowID) {
        logger.warn("startDebugging: getWorkflowID returned undefined", { folder: folder.uri.fsPath, debugConfig });
        return undefined;
      }

      const workflowStatus = await getWorkflowStatus(debugConfig, workflowID);
      if (!workflowStatus) {
          logger.error(`startDebugging: Workflow ID ${workflowID} not found`, { folder: folder.uri.fsPath, debugConfig });
          vscode.window.showErrorMessage(`Workflow ID ${workflowID} not found`);
          return undefined;
      }

      const proxyLaunched = await vscode.commands.executeCommand<boolean>(launchDebugProxyCommandName, debugConfig);
      if (!proxyLaunched) {
          logger.warn("startDebugging: launchDebugProxy returned false", { folder: folder.uri.fsPath, debugConfig, workflowID });
          return undefined;
      }

      const launchConfig = getDebugLaunchConfig(folder, workflowID);
      logger.info(`startDebugging`, { folder: folder.uri.fsPath, debugConfig, launchConfig });

      const debuggerStarted = await vscode.debug.startDebugging(folder, launchConfig);
      if (!debuggerStarted) {
          throw new Error("startDebugging: Debugger failed to start", {
              cause: {
                  folder: folder.uri.fsPath,
                  debugConfig,
                  workflowID,
                  launchConfig,
              }
          });
      }
    });
}


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