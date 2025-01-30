import * as vscode from 'vscode';
import { S3CloudStorage } from './CloudStorage';
import { CodeLensProvider } from './CodeLensProvider';
import { registerCommands, updateDebugProxyCommandName, } from './commands';
import { Configuration } from './Configuration';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { UriHandler } from './UriHandler';
import { CloudDataProvider } from './CloudDataProvider';
import { shutdownProvenanceDbConnectionPool } from './provenanceDb';
import { shutdownDebugProxy } from './debugProxy';
import { CloudCredentialManager } from './dbosCloudApi';

export let logger: Logger;
// export let config: Configuration;

export async function activate(context: vscode.ExtensionContext) {

  const transport = new LogOutputChannelTransport('DBOS');
  logger = createLogger(transport);
  context.subscriptions.push({ dispose() { logger.close(); transport.close(); } });

  logger.info("DBOS extension activated");

  const credManager = new CloudCredentialManager(context.secrets);
  const cloudDataProvider = new CloudDataProvider(credManager);
  const codeLensProvider = new CodeLensProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "dbos-ttdbg.views.resources", cloudDataProvider),
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      codeLensProvider),
  );

  // config = new Configuration(context.secrets, context.workspaceState);

  // const cloudStorage = new S3CloudStorage();
  // context.subscriptions.push(cloudStorage);

  // 

  // context.subscriptions.push(
  //   ...registerCommands(cloudStorage, context.globalStorageUri, (domain: string) => cloudDataProvider.refresh(domain)),
  //   { dispose() { shutdownProvenanceDbConnectionPool(); } },
  //   { dispose() { shutdownDebugProxy(); } },

  //   vscode.window.registerTreeDataProvider("dbos-ttdbg.views.resources", cloudDataProvider),

  //   vscode.languages.registerCodeLensProvider(
  //     { scheme: 'file', language: 'typescript' },
  //     new CodeLensProvider()),

  //   vscode.window.registerUriHandler(new UriHandler())
  // );

  // vscode.commands.executeCommand(updateDebugProxyCommandName);
}

export function deactivate() { }


