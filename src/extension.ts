import * as vscode from 'vscode';
import { CodeLensProvider } from './CodeLensProvider';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { CloudDataProvider } from './CloudDataProvider';
import { CloudCredentialManager } from './CloudCredentialManager';
import { S3Storage } from './BlobStorage';
import { DebugProxyManager } from './DebugProxyManager';

export let logger: Logger;

const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
const deleteDomainCredentialsCommandName = "dbos-ttdbg.delete-domain-credentials";
export const startDebuggingCodeLensCommandName = "dbos-ttdbg.start-debugging-code-lens";
const browseCloudAppCommandName = "dbos-ttdbg.browse-cloud-app";
const updateDebugProxyCommandName = "dbos-ttdbg.update-debug-proxy";

export async function activate(context: vscode.ExtensionContext) {

  const transport = new LogOutputChannelTransport('DBOS');
  logger = createLogger(transport);
  context.subscriptions.push({ dispose() { logger.close(); transport.close(); } });

  logger.info("DBOS extension activated");

  const credManager = new CloudCredentialManager(context.secrets);
  const cloudDataProvider = new CloudDataProvider(credManager);
  const codeLensProvider = new CodeLensProvider(credManager);
  const blobStorage = new S3Storage();
  const debugProxyManager = new DebugProxyManager(context.globalStorageUri);

  context.subscriptions.push(
    credManager,
    cloudDataProvider,
    codeLensProvider,
    blobStorage,
    debugProxyManager,

    vscode.window.registerTreeDataProvider(
      "dbos-ttdbg.views.resources",
      cloudDataProvider),
    vscode.languages.registerCodeLensProvider(
      { language: 'typescript' },
      codeLensProvider),

    vscode.commands.registerCommand(
      cloudLoginCommandName,
      credManager.getCloudLoginCommand()),
    vscode.commands.registerCommand(
      deleteDomainCredentialsCommandName,
      credManager.getDeleteCloudCredentialsCommand()),
    vscode.commands.registerCommand(
      startDebuggingCodeLensCommandName,
      codeLensProvider.getCodeLensDebugCommand()),
    vscode.commands.registerCommand(
      browseCloudAppCommandName,
      CloudDataProvider.browseCloudApp),
    vscode.commands.registerCommand(
      updateDebugProxyCommandName,
      debugProxyManager.getUpdateDebugProxyCommand(blobStorage)),
  );

  vscode.commands.executeCommand(updateDebugProxyCommandName);

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

}

export function deactivate() { }