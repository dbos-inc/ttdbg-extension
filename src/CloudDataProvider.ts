import * as vscode from 'vscode';
import { DbosCloudApp, DbosCloudDatabase, DbosCloudCredentials, listApps, listDatabases, getCloudOptions, authenticate, isTokenExpired } from './dbosCloudApi';

interface CloudServiceType {
  serviceType: "Applications" | "Databases";
  serviceDomain: string;
};

export interface CloudDomain {
  domain: string;
};

type CloudProviderNode = CloudDomain | DbosCloudApp | DbosCloudDatabase | CloudServiceType;

function isDomain(node: CloudProviderNode): node is CloudDomain {
  return "domain" in node;
}

function isServiceType(node: CloudProviderNode): node is CloudServiceType {
  return "serviceType" in node && "serviceDomain" in node;
}

function isCloudDatabase(node: CloudProviderNode): node is DbosCloudDatabase {
  return "PostgresInstanceName" in node
    && "HostName" in node
    && "Status" in node
    && "Port" in node
    && "DatabaseUsername" in node
    && "AdminUsername" in node;
}

function isCloudApp(node: CloudProviderNode): node is DbosCloudApp {
  return "Name" in node
    && "ID" in node
    && "PostgresInstanceName" in node
    && "ApplicationDatabaseName" in node
    && "Status" in node
    && "Version" in node
    && "AppURL" in node;
}

function domainSecretKey(domain: string) { return `dbos-ttdbg:domain:${domain}`; }

export class CloudDataProvider implements vscode.TreeDataProvider<CloudProviderNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CloudProviderNode | CloudProviderNode[] | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly domains = new Set<string>();

  constructor(private readonly secrets: vscode.SecretStorage) {
    const { cloudDomain } = getCloudOptions();
    this.domains.add(cloudDomain);
  }

  async #getStoredCredentials(domain: string): Promise<DbosCloudCredentials | undefined> {
    const secretKey = domainSecretKey(domain);
    const json = await this.secrets.get(secretKey);
    if (json) {
      const credentials = JSON.parse(json) as DbosCloudCredentials;
      if (!isTokenExpired(credentials.token)) {
        return credentials;
      }
      await this.secrets.delete(secretKey);
    }
    return undefined;
  }

  async deleteStoredCredentials(domain: string) {
    const secretKey = domainSecretKey(domain);
    await this.secrets.delete(secretKey);
  }

  async #authenticate(domain: string): Promise<DbosCloudCredentials | undefined> {
    const credentials = await authenticate(domain);
    if (credentials) {
      const secretKey = domainSecretKey(domain);
      await this.secrets.store(secretKey, JSON.stringify(credentials));
    }
    return credentials;
  }

  async #getCredentials(domain: string) {
    const storedCredentials = await this.#getStoredCredentials(domain);
    if (storedCredentials) {
      return storedCredentials;
    }
    return await this.#authenticate(domain);
  }

  async getChildren(element?: CloudProviderNode | undefined): Promise<CloudProviderNode[]> {
    if (element === undefined) {
      const children = new Array<CloudDomain>();
      for (const domain of this.domains) {
        children.push({ domain });
      }
      return children;
    }

    if (isDomain(element)) {
      return [
        { serviceDomain: element.domain, serviceType: "Applications" },
        { serviceDomain: element.domain, serviceType: "Databases" },
      ];
    }

    if (isServiceType(element)) {
      const credentials = await this.#getCredentials(element.serviceDomain);
      if (!credentials) { return []; }
      switch (element.serviceType) {
        case "Applications":
          return await listApps(credentials);
        case "Databases":
          return await listDatabases(credentials);
        default:
          throw new Error(`Unknown serviceType: ${element.serviceType}`);
      }
    }

    return [];
  }

  getTreeItem(element: CloudProviderNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    if (isDomain(element)) {
      return {
        label: element.domain,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        contextValue: "cloudDomain",
      };
    }

    if (isServiceType(element)) {
      const contextValue = element.serviceType === "Applications" ? "cloudApps" : "cloudDatabases";
      return {
        label: element.serviceType,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        contextValue
      };
    }

    if (isCloudApp(element)) {
      return {
        label: element.Name,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: "cloudApp",
      };
    }

    if (isCloudDatabase(element)) {
      return {
        label: element.PostgresInstanceName,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: "cloudDatabase",
      };
    }

    throw new Error(`Unknown element type: ${JSON.stringify(element)}`);
  }
}
