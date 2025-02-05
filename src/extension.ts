import * as vscode from 'vscode';
import { S3CloudStorage } from './CloudStorage';
import { CodeLensProvider, connectionMap, startDebuggingFromCodeLens } from './CodeLensProvider';
import { Configuration } from './Configuration';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { UriHandler } from './UriHandler';
import { CloudDataProvider } from './CloudDataProvider';
import { shutdownProvenanceDbConnectionPool } from './provenanceDb';
import { shutdownDebugProxy } from './debugProxy';
import { CloudCredentialManager } from './CloudCredentialManager';

export let logger: Logger;
// export let config: Configuration;

export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
export const deleteDomainCredentialsCommandName = "dbos-ttdbg.delete-domain-credentials";
export const getProxyUrlCommandName = "dbos-ttdbg.get-proxy-url";
export const launchDashboardCommandName = "dbos-ttdbg.launch-dashboard";
export const launchDebugProxyCommandName = "dbos-ttdbg.launch-debug-proxy";
export const pickWorkflowIdCommandName = "dbos-ttdbg.pick-workflow-id";
export const refreshDomainCommandName = "dbos-ttdbg.refresh-domain";
export const setApplicationNameCommandName = "dbos-ttdbg.set-app-name";
export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export const startDebuggingCodeLensCommandName = "dbos-ttdbg.start-debugging-code-lens";
export const startDebuggingUriCommandName = "dbos-ttdbg.start-debugging-uri";
export const updateDebugProxyCommandName = "dbos-ttdbg.update-debug-proxy";


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
      "dbos-ttdbg.views.resources",
      cloudDataProvider),
    vscode.languages.registerCodeLensProvider(
      { language: 'typescript' },
      codeLensProvider),
    connectionMap,
    vscode.commands.registerCommand(
      startDebuggingCodeLensCommandName,
      startDebuggingFromCodeLens),
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