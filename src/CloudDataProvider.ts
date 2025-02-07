import * as vscode from 'vscode';
import { DbosCloudApp, getCloudDomain, DbosCloudDbInstance, listApps, listDbInstances, isUnauthorized, DbosCloudCredential } from './dbosCloudApi';
import { CloudCredentialManager } from './CloudCredentialManager';

class CloudDomainLoginNeededItem extends vscode.TreeItem {
  constructor() {
    super("You need to login to DBOS Cloud.");
    this.contextValue = "cloudDomainLoginNeeded";
  }
}

const domainLoginNeeded = new CloudDomainLoginNeededItem();


class CloudDomainItem extends vscode.TreeItem {
  readonly appItem: CloudResourceTypeItem;
  readonly dbInstanceItem: CloudResourceTypeItem;

  private apps: Array<CloudAppItem> | undefined;
  private dbInstances: Array<CloudDbInstanceItem> | undefined;

  constructor(
    public readonly domain: string,
    readonly getCredential: (domain: string) => Promise<DbosCloudCredential | undefined>,
  ) {
    super(domain, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "cloudDomain";
    this.appItem = new CloudResourceTypeItem("apps", this);
    this.dbInstanceItem = new CloudResourceTypeItem("dbInstances", this);
  }

  async getChildren() {
    this.apps = undefined;
    this.dbInstances = undefined;

    const credential = await this.getCredential(this.domain);
    if (credential) {
      const [apps, dbInstances] = await Promise.all([
        listApps(credential),
        listDbInstances(credential)]);
      if (!isUnauthorized(apps)) {
        this.apps = apps.map(app => new CloudAppItem(app));
      }
      if (!isUnauthorized(dbInstances)) {
        this.dbInstances = dbInstances.map(dbi => new CloudDbInstanceItem(dbi));
      }
    }

    return credential
      ? [this.appItem, this.dbInstanceItem]
      : [domainLoginNeeded];
  }

  getApps() {
    return this.apps ?? [];
  }

  getDbInstances() {
    return this.dbInstances ?? [];
  }
}

class CloudResourceTypeItem extends vscode.TreeItem {
  constructor(
    public readonly type: "apps" | "dbInstances",
    readonly parent: CloudDomainItem,
  ) {
    super(type === "apps" ? "Applications" : "Database Instances", vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "cloudResourceType";
  }

  getChildren() {
    return this.type === "apps"
      ? this.parent.getApps()
      : this.parent.getDbInstances();
  }
}

class CloudAppItem extends vscode.TreeItem {
  constructor(readonly app: DbosCloudApp) {
    super(app.Name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "cloudApp";
    const tooltip = `
Database Instance: ${app.PostgresInstanceName}\n
Database Name: ${app.ApplicationDatabaseName}\n
Status: ${app.Status}\n
Version: ${app.Version}\n
Application URL: ${app.AppURL}`;

    this.tooltip = new vscode.MarkdownString(tooltip);
  }
}

class CloudDbInstanceItem extends vscode.TreeItem {
  constructor(readonly dbi: DbosCloudDbInstance) {
    super(dbi.PostgresInstanceName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "cloudDbInstance";
    const tooltip = `
Host Name: ${dbi.HostName}\n
Port: ${dbi.Port}\n
Username: ${dbi.DatabaseUsername}\n
Status: ${dbi.Status}`;
    this.tooltip = new vscode.MarkdownString(tooltip);
  }
}

type CloudProviderNode = CloudDomainItem | CloudResourceTypeItem | CloudAppItem | CloudDbInstanceItem | CloudDomainLoginNeededItem;

export class CloudDataProvider implements vscode.TreeDataProvider<CloudProviderNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CloudProviderNode | CloudProviderNode[] | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly domains: Array<CloudDomainItem>;

  constructor(private readonly credManager: CloudCredentialManager) {
    const { cloudDomain } = getCloudDomain();
    this.domains = [
      new CloudDomainItem(
        cloudDomain,
        (domain) => this.credManager.getStoredCredential(domain))
    ];
  }

  async refresh(domain: string) {
    const node = this.domains.find(d => d.domain === domain);
    if (node) {
      node.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      this.onDidChangeTreeDataEmitter.fire(node);
    }
  }

  getTreeItem(element: CloudProviderNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }
  async getChildren(element?: CloudProviderNode | undefined): Promise<CloudProviderNode[]> {
    if (element === undefined) {
      return this.domains;
    }

    if (element instanceof CloudDomainItem) {
      return await element.getChildren();
    }

    if (element instanceof CloudResourceTypeItem) {
      return element.getChildren();
    }

    return [];
  }

  async getStoredCredential(domain: string) {
    const credential = await this.credManager.getStoredCredential(domain);
    return CloudCredentialManager.isCredentialValid(credential) ? credential : undefined;
  }
}

export async function browseCloudApp(item?: CloudAppItem) {
  if (!item) { return; }
  const uri = vscode.Uri.parse(item.app.AppURL);
  await vscode.env.openExternal(uri);
}