import * as vscode from 'vscode';
import { DbosCloudApp, getCloudDomain, DbosCloudDbInstance, listApps, listDbInstances, isUnauthorized, CloudCredentialManager } from './dbosCloudApi';
// import { config } from './extension';
import { validateCredentials } from './validateCredentials';

export interface CloudDomainNode {
  kind: "cloudDomain";
  domain: string;
}

interface CloudResourceTypeNode {
  kind: "cloudResourceType";
  type: "apps" | "dbInstances";
  domain: string;
};

export interface CloudAppNode {
  kind: "cloudApp";
  domain: string;
  app: DbosCloudApp;
};

export interface CloudDbInstanceNode {
  kind: "cloudDbInstance";
  domain: string;
  dbInstance: DbosCloudDbInstance;
}

type CloudProviderNode = CloudDomainNode | CloudResourceTypeNode | CloudAppNode | CloudDbInstanceNode;

export class CloudDataProvider implements vscode.TreeDataProvider<CloudProviderNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CloudProviderNode | CloudProviderNode[] | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly domains: Array<CloudDomainNode>;
  private readonly apps = new Map<string, CloudAppNode[]>();
  private readonly dbInstances = new Map<string, CloudDbInstanceNode[]>();

  constructor(private readonly credManager: CloudCredentialManager) {
    const { cloudDomain } = getCloudDomain();
    this.domains = [{ kind: "cloudDomain", domain: cloudDomain }];
  }

  async refresh(domain: string) {
    this.apps.delete(domain);
    this.dbInstances.delete(domain);

    const node = this.domains.find(d => d.domain === domain);
    if (node) {
      this.onDidChangeTreeDataEmitter.fire(node);
    }
  }

  async getChildren(element?: CloudProviderNode | undefined): Promise<CloudProviderNode[]> {
    if (element === undefined) {
      return this.domains;
    }

    if (element.kind === "cloudDomain") {
      if (!this.apps.has(element.domain) || !this.dbInstances.has(element.domain)) {
        const credentials = await this.credManager.getCredentials(element.domain);
        if (!validateCredentials(credentials)) { return []; }

        const [apps, dbInstances] = await Promise.all([listApps(credentials), listDbInstances(credentials)]);
        if (isUnauthorized(apps)) {
          this.apps.delete(element.domain);
        } else {
          this.apps.set(element.domain, apps.map(a => ({ kind: "cloudApp", domain: element.domain, app: a })));
        }
        if (isUnauthorized(dbInstances)) {
          this.dbInstances.delete(element.domain);
        } else {
          this.dbInstances.set(element.domain, dbInstances.map(dbi => ({ kind: "cloudDbInstance", domain: element.domain, dbInstance: dbi })));
        }
        return [
          { kind: "cloudResourceType", type: "apps", domain: element.domain },
          { kind: "cloudResourceType", type: "dbInstances", domain: element.domain },
        ];
      }
    }

    if (element.kind === "cloudResourceType") {
      switch (element.type) {
        case "apps": {
          return this.apps.get(element.domain) ?? [];
        }
        case "dbInstances": {
          return this.dbInstances.get(element.domain) ?? [];
        }
        default:
          const _: never = element.type;
          throw new Error(`Unknown service type: ${element.type}`);
      }
    }

    return [];
  }

  getTreeItem(element: CloudProviderNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    const { kind } = element;
    switch (kind) {
      case "cloudDomain": {
        return {
          label: element.domain,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          contextValue: element.kind,
        };
      }
      case 'cloudResourceType': {
        let label: string;
        switch (element.type) {
          case "apps": label = "Applications"; break;
          case "dbInstances": label = "Database Instances"; break;
          default:
            const _: never = element.type;
            throw new Error(`Unknown service type: ${element.type}`);
        }
        return {
          label,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          contextValue: element.kind,
        };
      }
      case 'cloudApp': {
        const { app } = element;
        const tooltip = `
Database Instance: ${app.PostgresInstanceName}\n
Database Name: ${app.ApplicationDatabaseName}\n
Status: ${app.Status}\n
Version: ${app.Version}\n
Application URL: ${app.AppURL}`;

        return {
          label: app.Name,
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          contextValue: element.kind,
          tooltip: new vscode.MarkdownString(tooltip)
        };
      }
      case 'cloudDbInstance': {
        const { dbInstance: dbi } = element;
        const tooltip = `
Host Name: ${dbi.HostName}\n
Port: ${dbi.Port}\n
Username: ${dbi.DatabaseUsername}\n
Status: ${dbi.Status}`;

        return {
          label: element.dbInstance.PostgresInstanceName,
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          contextValue: element.kind,
          tooltip: new vscode.MarkdownString(tooltip)
        };
      }
      default:
        const _: never = kind;
        throw new Error(`Unknown service type: ${kind}`);
    }
  }
}
