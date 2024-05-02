import * as vscode from 'vscode';
import { S3CloudStorage } from './CloudStorage';
import { CodeLensProvider } from './CodeLensProvider';
import { registerCommands, updateDebugProxyCommandName, } from './commands';
import { Configuration } from './Config';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { UriHandler } from './UriHandler';
import { CloudDataProvider } from './CloudDataProvider';
import { getPoolDisposable } from './getWorkflowStatuses';

export let logger: Logger;
export let config: Configuration;

export async function activate(context: vscode.ExtensionContext) {

  const transport = new LogOutputChannelTransport('DBOS');
  logger = createLogger(transport);
  context.subscriptions.push({ dispose() { logger.close(); transport.close(); } });

  config = new Configuration(context.secrets);

  const cloudStorage = new S3CloudStorage();
  context.subscriptions.push(cloudStorage);

  const cloudDataProvider = new CloudDataProvider();

  context.subscriptions.push(
    ...registerCommands(cloudStorage, context.globalStorageUri, (domain: string) => cloudDataProvider.refresh(domain)),
    getPoolDisposable(),

    vscode.window.registerTreeDataProvider("dbos-ttdbg.views.resources", cloudDataProvider),

    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      new CodeLensProvider()),

    vscode.window.registerUriHandler(new UriHandler())
  );

  vscode.commands.executeCommand(updateDebugProxyCommandName);
}

export function deactivate() { }


