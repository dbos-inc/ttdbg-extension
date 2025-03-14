import * as vscode from 'vscode';
import { logger } from './extension';

export class UriHandler implements vscode.UriHandler {
    async handleUri(uri: vscode.Uri): Promise<void> {
        logger.info(`UriHandler.handleUri`, { uri: uri.toString() });
        const searchParams = new URLSearchParams(uri.query);
        const appName = searchParams.get('app_name');
        const workflowID = searchParams.get('workflow_id');

        switch (uri.path) {
            case '/debug':
                vscode.window.showInformationMessage(`Starting DBOS Replay Debugger for ${appName} with workflow ID ${workflowID}`);
                break;
            case '/tt-debug':
                vscode.window.showInformationMessage(`Starting DBOS TimeTravel Debugger for ${appName} with workflow ID ${workflowID}`);
                break;
            default:
                vscode.window.showErrorMessage(`Unsupported uri: ${uri.path}}`);
        }
    }
}
