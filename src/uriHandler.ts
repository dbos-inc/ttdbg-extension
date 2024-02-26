import * as vscode from 'vscode';
import { logger } from './extension';
import { startDebuggingUriCommandName } from './commands';

export class TTDbgUriHandler implements vscode.UriHandler {
	async handleUri(uri: vscode.Uri): Promise<void> {
		logger.debug(`TTDbgUriHandler.handleUri`, { uri: uri.toString() });
		switch (uri.path) {
			case '/start-debugging': 
				const searchParams = new URLSearchParams(uri.query);
				const wfID = searchParams.get('wfid');
				if (wfID) {
					vscode.commands.executeCommand(startDebuggingUriCommandName, wfID);
				} else {
					vscode.window.showErrorMessage(`Invalid start-debugging uri: ${uri}`);
				}
				break;
			default:
				vscode.window.showErrorMessage(`Unsupported uri: ${uri.path}}`);
		}
	}
}
