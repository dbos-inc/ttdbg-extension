import * as vscode from 'vscode';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { S3CloudStorage } from './CloudStorage';
import { DebugProxy, deleteProvDBPasswordCommandName, launchDebugProxyCommandName, startDebuggingCommandName } from './DebugProxy';

export let logger: Logger;

export function activate(context: vscode.ExtensionContext) {

  const transport = new LogOutputChannelTransport('DBOS Time Travel Debugger');
  logger = createLogger(transport);
  context.subscriptions.push({ dispose() { logger.close(); transport.close(); } });

  const cloudStorage = new S3CloudStorage();
  context.subscriptions.push(cloudStorage);

  const debugProxy = new DebugProxy(cloudStorage, context.secrets, context.globalStorageUri);
  context.subscriptions.push(debugProxy);

  debugProxy.update().catch(e => logger.error(e));

  context.subscriptions.push(
    vscode.commands.registerCommand(
      startDebuggingCommandName,
      debugProxy.startDebugging, debugProxy));
  context.subscriptions.push(
    vscode.commands.registerCommand(
      launchDebugProxyCommandName,
      debugProxy.launch, debugProxy));
  context.subscriptions.push(
    vscode.commands.registerCommand(
      deleteProvDBPasswordCommandName,
      debugProxy.deleteStoredPassword, debugProxy));
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      new TTDbgCodeLensProvider()));
}

// export function deactivate(): Promise<void> { 
//   return Promise.resolve();
// }


