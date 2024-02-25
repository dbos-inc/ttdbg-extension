import * as vscode from 'vscode';
import { S3CloudStorage } from './CloudStorage';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import { deleteProvenanceDatabasePasswords, deleteProvDbPasswordsCommandName, startDebuggingCommandName, startDebugging, shutdownDebugProxyCommandName, shutdownDebugProxy, cloudLoginCommandName, cloudLogin } from './commands';
import { Configuration } from './configuration';
import { DebugProxy, } from './DebugProxy';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { ProvenanceDatabase } from './ProvenanceDatabase';

export let logger: Logger;
export let config: Configuration;
export let provDB: ProvenanceDatabase;
export let debugProxy: DebugProxy;

export async function activate(context: vscode.ExtensionContext) {

  const transport = new LogOutputChannelTransport('DBOS');
  logger = createLogger(transport);
  context.subscriptions.push({ dispose() { logger.close(); transport.close(); } });

  config = new Configuration(context.secrets);

  provDB = new ProvenanceDatabase();
  context.subscriptions.push(provDB);

  const cloudStorage = new S3CloudStorage();
  context.subscriptions.push(cloudStorage);

  debugProxy = new DebugProxy(cloudStorage, context.globalStorageUri);
  context.subscriptions.push(debugProxy);

  context.subscriptions.push(
    vscode.commands.registerCommand(startDebuggingCommandName, startDebugging));
  context.subscriptions.push(
    vscode.commands.registerCommand(shutdownDebugProxyCommandName, shutdownDebugProxy));
  context.subscriptions.push(
    vscode.commands.registerCommand(deleteProvDbPasswordsCommandName, deleteProvenanceDatabasePasswords));
  context.subscriptions.push(
    vscode.commands.registerCommand(cloudLoginCommandName, cloudLogin));

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      new TTDbgCodeLensProvider()));

  await debugProxy.update().catch(e => {
    logger.error("Debug Proxy Update Failed", e);
    vscode.window.showErrorMessage(`Debug Proxy Update Failed`);
  });
}

export function deactivate() { }
