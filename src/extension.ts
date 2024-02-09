import "reflect-metadata";

import * as vscode from 'vscode';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import logger from './logger';
import { CloudStorage, S3CloudStorage } from './CloudStorage';
import { DebugProxy, startDebuggingCommandName } from './DebugProxy';

export function activate(context: vscode.ExtensionContext) {

  const cloudStorage = new S3CloudStorage();
  context.subscriptions.push(cloudStorage);

  const debugProxy = new DebugProxy(cloudStorage, context.globalStorageUri);
  context.subscriptions.push(debugProxy);

  debugProxy.update().catch(e => logger.error(e));

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


