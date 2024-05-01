import * as vscode from 'vscode';
import { S3CloudStorage } from './CloudStorage';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import { deleteStoredPasswords, deleteStoredPasswordsCommandName, shutdownDebugProxyCommandName, shutdownDebugProxy, cloudLoginCommandName, cloudLogin, startDebuggingCodeLensCommandName, startDebuggingFromCodeLens, startDebuggingFromUri, startDebuggingUriCommandName, getProxyUrl, getProxyUrlCommandName, pickWorkflowIdCommandName, pickWorkflowId, deleteDomainCredentials, deleteDomainCredentialsCommandName, deleteAppDatabasePassword, deleteAppDatabasePasswordCommandName, refreshDomainCommandName, refreshDomain, updateDebugProxyCommandName, getUpdateDebugProxyCommand, launchDebugProxyCommandName, getLaunchDebugProxyCommand } from './commands';
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
    vscode.commands.registerCommand(cloudLoginCommandName, cloudLogin),
    vscode.commands.registerCommand(deleteDomainCredentialsCommandName, deleteDomainCredentials),
    vscode.commands.registerCommand(deleteAppDatabasePasswordCommandName, deleteAppDatabasePassword),
    vscode.commands.registerCommand(deleteStoredPasswordsCommandName, deleteStoredPasswords),
    vscode.commands.registerCommand(shutdownDebugProxyCommandName, shutdownDebugProxy),
    vscode.commands.registerCommand(startDebuggingCodeLensCommandName, startDebuggingFromCodeLens),
    vscode.commands.registerCommand(startDebuggingUriCommandName, startDebuggingFromUri),
    vscode.commands.registerCommand(refreshDomainCommandName, refreshDomain),
    vscode.commands.registerCommand(updateDebugProxyCommandName, getUpdateDebugProxyCommand(cloudStorage, context.globalStorageUri)),
    vscode.commands.registerCommand(launchDebugProxyCommandName, getLaunchDebugProxyCommand(context.globalStorageUri)),

    vscode.commands.registerCommand(getProxyUrlCommandName, getProxyUrl),
    vscode.commands.registerCommand(pickWorkflowIdCommandName, pickWorkflowId),

    vscode.window.registerTreeDataProvider("dbos-ttdbg.views.resources", cloudDataProvider),

    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      new TTDbgCodeLensProvider()),

    vscode.window.registerUriHandler(new TTDbgUriHandler())
  );

  vscode.commands.executeCommand(updateDebugProxyCommandName);
}

export function deactivate() { }
