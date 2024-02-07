import * as vscode from 'vscode';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import logger from './logger';
import { CloudStorage, S3CloudStorage } from './CloudStorage';
import { DebugProxy, startDebuggingCommandName, updateDebugProxyCommandName } from './DebugProxy';


export function activate(context: vscode.ExtensionContext) {

  const cloudStorage: CloudStorage = new S3CloudStorage();
  const debugProxy = new DebugProxy(cloudStorage, context.globalStorageUri);

  debugProxy.update().catch(e => logger.error(e));

  context.subscriptions.push(debugProxy);
  context.subscriptions.push(
    vscode.commands.registerCommand(
      updateDebugProxyCommandName,
      debugProxy.update, debugProxy));
  context.subscriptions.push(
    vscode.commands.registerCommand(
      startDebuggingCommandName,
      debugProxy.startDebugging, debugProxy));
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      new TTDbgCodeLensProvider()));
}

// export function deactivate(): Promise<void> { 
//   return Promise.resolve();
// }


