import * as vscode from 'vscode';
import { DbosCloudApp, DbosCloudDatabase, DbosCloudCredentials, listApps, listDatabases, getCloudDomain, authenticate, isTokenExpired, DbosCloudDomain } from './dbosCloudApi';
import { config } from './extension';

export interface CloudDomainNode {
  kind: "cloudDomain";
  domain: string;
  credentials?: DbosCloudCredentials;
}

interface CloudServiceTypeNode {
  kind: "cloudServiceType";
  type: "Applications" | "Databases";
  domain: string;
  credentials?: DbosCloudCredentials;
};

export interface CloudAppNode {
  kind: "cloudApp";
  app: DbosCloudApp;
  credentials: DbosCloudCredentials;
};

export interface CloudDatabaseNode {
  kind: "cloudDatabase";
  database: DbosCloudDatabase;
  credentials: DbosCloudCredentials;
}

type CloudProviderNode = CloudDomainNode | CloudServiceTypeNode | CloudAppNode | CloudDatabaseNode;

export class CloudDataProvider implements vscode.TreeDataProvider<CloudProviderNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CloudProviderNode | CloudProviderNode[] | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly domains = new Set<string>();

  constructor() {
    const { cloudDomain } = getCloudDomain();
    this.domains.add(cloudDomain);
  }

  async #getCredentials(domain?: string | DbosCloudDomain): Promise<DbosCloudCredentials | undefined> {
    const storedCredentials = await config.getStoredCloudCredentials(domain);
    if (storedCredentials) {
      return storedCredentials;
    }
    return await config.cloudLogin(domain);
  }

  async getChildren(element?: CloudProviderNode | undefined): Promise<CloudProviderNode[]> {
    if (element === undefined) {
      const children = new Array<CloudDomainNode>();
      for (const domain of this.domains) {
        const credentials = await config.getStoredCloudCredentials(domain);
        children.push({ kind: 'cloudDomain', domain, credentials });
      }
      return children;
    }

    if (element.kind === "cloudDomain") {
      return [
        <CloudServiceTypeNode>{ kind: 'cloudServiceType', domain: element.domain, credentials: element.credentials, type: "Applications" },
        <CloudServiceTypeNode>{ kind: 'cloudServiceType', domain: element.domain, credentials: element.credentials, type: "Databases" },
      ];
    }

    if (element.kind === "cloudServiceType") {
      const credentials = element.credentials ?? await this.#getCredentials(element.domain);  
      if (!credentials) { return []; }
      switch (element.type) {
        case "Applications": {
          const apps = await listApps(credentials);
          return apps.map(app => ({ kind: "cloudApp", app, credentials }));
        }
        case "Databases": {
          const dbs = await listDatabases(credentials);
          return dbs.map(database => ({ kind: "cloudDatabase", database, credentials }));
        }
        default:
          throw new Error(`Unknown service type: ${element.type}`);
      }
    }

    return [];
  }

  getTreeItem(element: CloudProviderNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    if (element.kind === 'cloudDomain') {
      return {
        label: element.domain,
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        contextValue: element.kind,
      };
    }

    if (element.kind === 'cloudServiceType') {
      return {
        label: element.type,
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        contextValue: element.kind,
      };
    }

    if (element.kind === 'cloudApp') {
      return {
        label: element.app.Name,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: element.kind,
      };
    }

    if (element.kind === 'cloudDatabase') {
      return {
        label: element.database.PostgresInstanceName,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: element.kind,
      };
    }

    throw new Error(`Unknown element type: ${JSON.stringify(element)}`);
  }
}
