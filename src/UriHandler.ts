import * as vscode from 'vscode';
import { getCloudConnectionsCommandName, launchDebuggerCommandName, logger } from './extension';
import { DbosConfig, loadConfigFile } from './dbosConfig';
import type { CloudConnections } from './CodeLensProvider';
import { time } from 'console';

export class UriHandler implements vscode.UriHandler {
    async handleUri(uri: vscode.Uri): Promise<void> {
        logger.info(`UriHandler.handleUri`, { uri: uri.toString() });
        const searchParams = new URLSearchParams(uri.query);
        const appName = searchParams.get('app_name');
        const workflowID = searchParams.get('workflow_id');

        if (!appName || !workflowID) { return; }

        const config = await findConfig(appName);
        if (!config) { return; }

        const { cloudRelay, timeTravel } = await vscode.commands.executeCommand<CloudConnections>(getCloudConnectionsCommandName, config);

        switch (uri.path) {
            case '/debug':
                if (!cloudRelay) {
                    await vscode.window.showErrorMessage(`No cloud relay found for ${appName}`);
                    return;
                }
                await vscode.window.showInformationMessage(`Starting DBOS Replay Debugger for ${appName} with workflow ID ${workflowID}`);
                await vscode.commands.executeCommand(launchDebuggerCommandName, workflowID, config, cloudRelay);
                break;
            case '/tt-debug':
                if (!timeTravel) {
                    await vscode.window.showErrorMessage(`No cloud relay found for ${appName}`);
                    return;
                }
                await vscode.window.showInformationMessage(`Starting DBOS TimeTravel Debugger for ${appName} with workflow ID ${workflowID}`);
                await vscode.commands.executeCommand(launchDebuggerCommandName, workflowID, config, timeTravel);
                break;
            default:
                vscode.window.showErrorMessage(`Unsupported uri: ${uri.path}}`);
        }

        async function findConfig(appName: string) {
            const configFiles = await vscode.workspace.findFiles('**/dbos-config.yaml');
            for (const configFile of configFiles) {
                const config = await loadConfigFile(configFile);
                if (config && config.name === appName) {
                    return config;
                }
            }
            return undefined;
        }
    
    }
}
