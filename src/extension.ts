import * as vscode from 'vscode';
import { CodeLensProvider } from './CodeLensProvider';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { CloudDataProvider } from './CloudDataProvider';
import { CloudCredentialManager } from './CloudCredentialManager';
import { S3Storage } from './BlobStorage';
import { DebugProxyManager } from './DebugProxyManager';
import { UriHandler } from './UriHandler';

export let logger: Logger;

const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
const deleteDomainCredentialsCommandName = "dbos-ttdbg.delete-domain-credentials";
export const startDebuggingCodeLensCommandName = "dbos-ttdbg.start-debugging-code-lens";
const browseCloudAppCommandName = "dbos-ttdbg.browse-cloud-app";
const updateDebugProxyCommandName = "dbos-ttdbg.update-debug-proxy";
const launchDebugProxyCommandName = "dbos-ttdbg.launch-debug-proxy";
export const getCloudConnectionsCommandName = "dbos-ttdbg.get-cloud-connections";
export const launchDebuggerCommandName = "dbos-ttdbg.launch-debugger";

export async function activate(context: vscode.ExtensionContext) {

  const transport = new LogOutputChannelTransport('DBOS');
  logger = createLogger(transport);
  context.subscriptions.push({ dispose() { logger.close(); transport.close(); } });

  logger.info("DBOS extension activated");

  const credManager = new CloudCredentialManager(context.secrets, context.globalState);
  const debugProxyManager = new DebugProxyManager(
    credManager,
    context.globalStorageUri);
  const cloudDataProvider = new CloudDataProvider(credManager);
  const codeLensProvider = new CodeLensProvider(context.extension.id, credManager, debugProxyManager);
  const blobStorage = new S3Storage();

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
      [{ language: 'python' }, { language: 'typescript' }],
      codeLensProvider),
    vscode.window.registerUriHandler(new UriHandler()),

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
      launchDebuggerCommandName,
      codeLensProvider.getLaunchDebuggerCommand()),
    vscode.commands.registerCommand(
      getCloudConnectionsCommandName,
      codeLensProvider.getGetCloudConnectionsCommand()),
    vscode.commands.registerCommand(
      browseCloudAppCommandName,
      CloudDataProvider.browseCloudApp),
    vscode.commands.registerCommand(
      updateDebugProxyCommandName,
      debugProxyManager.getUpdateDebugProxyCommand(blobStorage)),
    vscode.commands.registerCommand(
      launchDebugProxyCommandName,
      debugProxyManager.getLaunchDebugProxyCommand()),
  );

  vscode.commands.executeCommand(updateDebugProxyCommandName);
}

export function deactivate() { }