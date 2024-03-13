import * as vscode from 'vscode';
import { DbosCloudApp, DbosCloudDatabase, DbosCredentials, listApps, listDatabases } from './dbosCloudApi';

type CloudProviderRoot = { childType: "Applications" | "Databases"; };
function getRootIcon({ childType }: CloudProviderRoot) {
  switch (childType) {
    case "Applications":
      return "icon-modern.svg";
    case "Databases":
      return "icon-stateful.svg";
    default: throw new Error(`Unknown childType: ${childType}`);
  }
}

type CloudProviderNode = CloudProviderRoot | DbosCloudApp | DbosCloudDatabase;

function isCloudProviderRoot(node: CloudProviderNode): node is CloudProviderRoot {
  return (node as CloudProviderRoot).childType !== undefined;
}
function isCloudDatabase(node: CloudProviderNode): node is DbosCloudDatabase {
  return (node as DbosCloudDatabase).HostName !== undefined;
}

export class CloudDataProvider implements vscode.TreeDataProvider<CloudProviderNode> {
  constructor(
    private readonly credentials: DbosCredentials,
    private readonly extensionPath: string,
  ) { }


  async getChildren(element?: CloudProviderNode | undefined): Promise<CloudProviderNode[]> {
    if (element === undefined) {
      return [
        { childType: "Applications" },
        { childType: "Databases" }
      ];
    }

    if (isCloudProviderRoot(element)) {
      switch (element.childType) {
        case "Applications":
          return await listApps(this.credentials);
        case "Databases":
          return await listDatabases(this.credentials);
        default:
          throw new Error(`Unknown childType: ${element.childType}`);
      }
    }

    return [];
  }

  getTreeItem(element: CloudProviderNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    if (isCloudProviderRoot(element)) {
      const item = new vscode.TreeItem(element.childType, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = vscode.Uri.joinPath(vscode.Uri.file(this.extensionPath), "resources", getRootIcon(element));
      return item;
    } else if (isCloudDatabase(element)) {
      const item = new vscode.TreeItem(element.PostgresInstanceName, vscode.TreeItemCollapsibleState.None);
      return item;
    } else {
      const item = new vscode.TreeItem(element.Name, vscode.TreeItemCollapsibleState.None);
      return item;
    }
  }
}
