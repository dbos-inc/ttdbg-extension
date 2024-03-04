import * as vscode from 'vscode';
import { S3CloudStorage } from './CloudStorage';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import { deleteProvenanceDatabasePasswords, deleteProvDbPasswordsCommandName, shutdownDebugProxyCommandName, shutdownDebugProxy, cloudLoginCommandName, cloudLogin, startDebuggingCodeLensCommandName, startDebuggingFromCodeLens, startDebuggingFromUri, startDebuggingUriCommandName, getProxyUrl, getProxyUrlCommandName, pickWorkflowIdCommandName, pickWorkflowId } from './commands';
import { Configuration } from './configuration';
import { DebugProxy, } from './DebugProxy';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { ProvenanceDatabase } from './ProvenanceDatabase';
import { TTDbgUriHandler } from './uriHandler';

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
    vscode.commands.registerCommand(cloudLoginCommandName, cloudLogin),
    vscode.commands.registerCommand(deleteProvDbPasswordsCommandName, deleteProvenanceDatabasePasswords),
    vscode.commands.registerCommand(shutdownDebugProxyCommandName, shutdownDebugProxy),
    vscode.commands.registerCommand(startDebuggingCodeLensCommandName, startDebuggingFromCodeLens),
    vscode.commands.registerCommand(startDebuggingUriCommandName, startDebuggingFromUri),

    vscode.commands.registerCommand(getProxyUrlCommandName, getProxyUrl),
    vscode.commands.registerCommand(pickWorkflowIdCommandName, pickWorkflowId),

    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      new TTDbgCodeLensProvider()),
    vscode.window.registerUriHandler(new TTDbgUriHandler())
  );

  await debugProxy.update().catch(e => {
    logger.error("Debug Proxy Update Failed", e);
    vscode.window.showErrorMessage(`Debug Proxy Update Failed`);
  });
}

export function deactivate() { }
