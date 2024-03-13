import * as vscode from 'vscode';
import { S3CloudStorage } from './CloudStorage';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import { deleteProvenanceDatabasePasswords, deleteProvenanceDatabasePasswordsCommandName, shutdownDebugProxyCommandName, shutdownDebugProxy, cloudLoginCommandName, cloudLogin, startDebuggingCodeLensCommandName, startDebuggingFromCodeLens, startDebuggingFromUri, startDebuggingUriCommandName, getProxyUrl, getProxyUrlCommandName, pickWorkflowIdCommandName, pickWorkflowId } from './commands';
import { Configuration } from './configuration';
import { DebugProxy, } from './DebugProxy';
import { LogOutputChannelTransport, Logger, createLogger } from './logger';
import { ProvenanceDatabase } from './ProvenanceDatabase';
import { TTDbgUriHandler } from './uriHandler';
import { authenticate } from './dbosCloud';

export let logger: Logger;
export let config: Configuration;
export let provDB: ProvenanceDatabase;
export let debugProxy: DebugProxy;

export async function activate(context: vscode.ExtensionContext) {

  const transport = new LogOutputChannelTransport('DBOS');
  logger = createLogger(transport);
  context.subscriptions.push({ dispose() { logger.close(); transport.close(); } });

  authenticate().catch(e => logger.error("foo", e));

  config = new Configuration(context.secrets);

  provDB = new ProvenanceDatabase();
  context.subscriptions.push(provDB);

  const cloudStorage = new S3CloudStorage();
  context.subscriptions.push(cloudStorage);

  debugProxy = new DebugProxy(cloudStorage, context.globalStorageUri);
  context.subscriptions.push(debugProxy);

  context.subscriptions.push(
    vscode.commands.registerCommand(cloudLoginCommandName, cloudLogin),
    vscode.commands.registerCommand(deleteProvenanceDatabasePasswordsCommandName, deleteProvenanceDatabasePasswords),
    vscode.commands.registerCommand(shutdownDebugProxyCommandName, shutdownDebugProxy),
    vscode.commands.registerCommand(startDebuggingCodeLensCommandName, startDebuggingFromCodeLens),
    vscode.commands.registerCommand(startDebuggingUriCommandName, startDebuggingFromUri),

    vscode.commands.registerCommand(getProxyUrlCommandName, getProxyUrl),
    vscode.commands.registerCommand(pickWorkflowIdCommandName, pickWorkflowId),

    // vscode.window.registerTreeDataProvider(
    //   "dbos-ttdbg.views.resources",
    //   new DbosCloudDataProvider()),

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

// export class DbosCloudDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
//   getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
//     return element;
//   }
//   async getChildren(element?: vscode.TreeItem | undefined): Promise<vscode.TreeItem[]> {
//     if (element === undefined) {
//       const items = new Array<vscode.TreeItem>();
//       for (const folder of vscode.workspace.workspaceFolders ?? []) {
//         const dbs = await dbosCloudAppList(folder);
//         items.push(...dbs.map(app => new vscode.TreeItem(app.Name, vscode.TreeItemCollapsibleState.None)));
//       }
//       return items;
//     }
//     return [];
//   }
// }



