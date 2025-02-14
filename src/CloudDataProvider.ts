import * as vscode from 'vscode';
import { DbosCloudApp, getCloudDomain, DbosCloudDbInstance, listApps, listDbInstances, isUnauthorized, DbosCloudCredential } from './dbosCloudApi';
import { CloudCredentialManager } from './CloudCredentialManager';

class CloudDomainLoginNeededItem extends vscode.TreeItem {
  constructor() {
    super("You need to login to DBOS Cloud.");
    this.contextValue = "cloudDomainLoginNeeded";
  }
}

class CloudDomainItem extends vscode.TreeItem {
  readonly appItem: CloudResourceTypeItem;
  readonly dbInstanceItem: CloudResourceTypeItem;

  private apps: Array<CloudAppItem> | undefined;
  private dbInstances: Array<CloudDbInstanceItem> | undefined;

  static readonly domainLoginNeeded = new CloudDomainLoginNeededItem();

  constructor(
    public readonly domain: string,
    private readonly credManager: CloudCredentialManager,
  ) {
    super(domain, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "cloudDomain";
    this.appItem = new CloudResourceTypeItem("apps", this);
    this.dbInstanceItem = new CloudResourceTypeItem("dbInstances", this);
  }

  async getChildren() {
    this.apps = undefined;
    this.dbInstances = undefined;

    const cred = await this.credManager.getCachedCredential(this.domain);
    if (cred && CloudCredentialManager.isCredentialValid(cred)) {
      const [apps, dbInstances] = await Promise.all([listApps(cred), listDbInstances(cred)]);
      this.apps = isUnauthorized(apps) ? undefined : apps.map(app => new CloudAppItem(app, this));
      this.dbInstances = isUnauthorized(dbInstances) ? undefined : dbInstances.map(dbi => new CloudDbInstanceItem(dbi, this));
      return [this.appItem, this.dbInstanceItem];
    }

    return [CloudDomainItem.domainLoginNeeded];
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

export class CloudAppItem extends vscode.TreeItem {
  constructor(readonly app: DbosCloudApp, readonly parent: CloudDomainItem) {
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

  get domain() { return this.parent.domain;}
}

class CloudDbInstanceItem extends vscode.TreeItem {
  constructor(readonly dbi: DbosCloudDbInstance, readonly parent: CloudDomainItem) {
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

export class CloudDataProvider implements vscode.TreeDataProvider<CloudProviderNode>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CloudProviderNode | CloudProviderNode[] | undefined | null | void>();
  private readonly credChangeSub: vscode.Disposable;
  private readonly domains: Array<CloudDomainItem>;

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly credManager: CloudCredentialManager) {
    this.credChangeSub = this.credManager.onCredentialChange((domain) => this.#refresh(domain));

    const { cloudDomain } = getCloudDomain();
    this.domains = [new CloudDomainItem(cloudDomain, this.credManager) ];
  }

  dispose() {
    this.credChangeSub.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  async #refresh(domain: string) {
    const node = this.domains.find(d => d.domain === domain);
    if (node) {
      node.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      this.onDidChangeTreeDataEmitter.fire(node);
    }
  }

  getTreeItem(element: CloudProviderNode): vscode.TreeItem {
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

  static async browseCloudApp(item?: CloudAppItem) {
    if (item) {
      const uri = vscode.Uri.parse(item.app.AppURL);
      await vscode.env.openExternal(uri);
    }
  }
}

