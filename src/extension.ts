import * as vscode from 'vscode';
import { S3CloudStorage } from './CloudStorage';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import { registerCommands, updateDebugProxyCommandName, } from './commands';
import { Configuration } from './configuration';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { ProvenanceDatabase } from './ProvenanceDatabase';
import { TTDbgUriHandler } from './uriHandler';
import { CloudDataProvider } from './CloudDataProvider';

export let logger: Logger;
export let config: Configuration;
export let provDB: ProvenanceDatabase;
export let cloudDataProvider: CloudDataProvider;

export async function activate(context: vscode.ExtensionContext) {

  const transport = new LogOutputChannelTransport('DBOS');
  logger = createLogger(transport);
  context.subscriptions.push({ dispose() { logger.close(); transport.close(); } });

  config = new Configuration(context.secrets);

  provDB = new ProvenanceDatabase();
  context.subscriptions.push(provDB);

  const cloudStorage = new S3CloudStorage();
  context.subscriptions.push(cloudStorage);

  cloudDataProvider = new CloudDataProvider();

  context.subscriptions.push(
    ...registerCommands(cloudStorage, context.globalStorageUri),

    vscode.window.registerTreeDataProvider("dbos-ttdbg.views.resources", cloudDataProvider),

    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      new TTDbgCodeLensProvider()),

    vscode.window.registerUriHandler(new TTDbgUriHandler())
  );

  vscode.commands.executeCommand(updateDebugProxyCommandName);
}

export function deactivate() { }
