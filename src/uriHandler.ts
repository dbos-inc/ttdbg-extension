import * as vscode from 'vscode';
import { logger } from './extension';
import { startDebuggingUriCommandName } from './commands';

export class TTDbgUriHandler implements vscode.UriHandler {
	async handleUri(uri: vscode.Uri): Promise<void> {
		logger.debug(`TTDbgUriHandler.handleUri`, { uri: uri.toString() });
		switch (uri.path) {
			case '/start-debugging':
				const searchParams = new URLSearchParams(uri.query);
				const wfid = searchParams.get('wfid');
				if (wfid) {
					vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: `Starting DBOS Time Travel Debugger for workflow ID ${wfid}`,
					}, async () => {
						await vscode.commands.executeCommand(startDebuggingUriCommandName, wfid);
					});
				} else {
					vscode.window.showErrorMessage(`Invalid start-debugging uri: ${uri}`);
				}
				break;
			default:
				vscode.window.showErrorMessage(`Unsupported uri: ${uri.path}}`);
		}
	}
}
