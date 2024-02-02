import * as vscode from 'vscode';
import debugProxy from './DebugProxy';
import { launchDebugger, launchDebuggerCommandName } from './commands';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import logger from './logger';

export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(launchDebuggerCommandName, launchDebugger));
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      new TTDbgCodeLensProvider()
    ));
}

export function deactivate() {
  logger.dispose();
  debugProxy.dispose();
}
