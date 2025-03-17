import * as vscode from 'vscode';
import { getCloudConnectionsCommandName, launchDebuggerCommandName, logger } from './extension';
import { loadConfigFile } from './dbosConfig';
import type { CloudConnections } from './CodeLensProvider';

export class UriHandler implements vscode.UriHandler {
    async handleUri(uri: vscode.Uri): Promise<void> {
        logger.info(`UriHandler.handleUri`, { uri: uri.toString() });
        const searchParams = new URLSearchParams(uri.query);
        const appName = searchParams.get('app_name');
        const workflowID = searchParams.get('workflow_id');

        if (!appName || !workflowID) { return; }

        const config = await findConfig(appName);
        if (!config) { 
            vscode.window.showErrorMessage(`Could not find dbos config file for ${appName} in the current workspace.`);
            return; 
        }

        const { cloudRelay, timeTravel } = await vscode.commands.executeCommand<CloudConnections>(getCloudConnectionsCommandName, config);

        switch (uri.path) {
            case '/debug':
                if (!cloudRelay) {
                    vscode.window.showErrorMessage(`Cloud replay connection information for ${appName} not found`);
                    return;
                }
                vscode.window.showInformationMessage(`Starting DBOS Replay Debugger for ${appName} with workflow ID ${workflowID}`);
                await vscode.commands.executeCommand(launchDebuggerCommandName, workflowID, config, cloudRelay);
                break;
            case '/tt-debug':
                if (!timeTravel) {
                    vscode.window.showErrorMessage(`Time travel connection information for ${appName} not found`);
                    return;
                }
                vscode.window.showInformationMessage(`Starting DBOS TimeTravel Debugger for ${appName} with workflow ID ${workflowID}`);
                await vscode.commands.executeCommand(launchDebuggerCommandName, workflowID, config, timeTravel);
                break;
            default:
                vscode.window.showErrorMessage(`Unsupported DBOS Debugger uri path: ${uri.path}}`);
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
