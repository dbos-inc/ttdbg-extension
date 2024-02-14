import * as vscode from 'vscode';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { S3CloudStorage } from './CloudStorage';
import { DebugProxy,  } from './DebugProxy';
import { ProvenanceDatabase } from './ProvenanceDatabase';
import { deleteProvenanceDatabasePassword, deleteProvDBPasswordCommandName, launchDebugProxy, launchDebugProxyCommandName, startDebuggingCommandName, startDebugging } from './commands';
import { DbosMethodType } from './sourceParser';
import { Configuration } from './Configuration';

export let logger: Logger;
export let config: Configuration;

export function activate(context: vscode.ExtensionContext) {

  const transport = new LogOutputChannelTransport('DBOS Time Travel Debugger');
  logger = createLogger(transport);
  context.subscriptions.push({ dispose() { logger.close(); transport.close(); } });

  config = new Configuration(context.secrets);

  const provDB = new ProvenanceDatabase();
  context.subscriptions.push(provDB);

  const cloudStorage = new S3CloudStorage();
  context.subscriptions.push(cloudStorage);

  const debugProxy = new DebugProxy(cloudStorage, context.globalStorageUri);
  context.subscriptions.push(debugProxy);

  debugProxy.update();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      startDebuggingCommandName,
      (name: string, $type: DbosMethodType) => startDebugging(provDB, name, $type)));
  context.subscriptions.push(
    vscode.commands.registerCommand(
      launchDebugProxyCommandName,
      launchDebugProxy));
  context.subscriptions.push(
    vscode.commands.registerCommand(
      deleteProvDBPasswordCommandName,
      () => deleteProvenanceDatabasePassword(provDB)));

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      new TTDbgCodeLensProvider()));
}

export function deactivate() {}
