import * as vscode from 'vscode';
import { getPackageName } from './utils';
import { logger } from './extension';
import { DbosCloudCredentials, DbosCloudDomain, authenticate, getAppInfo, getCloudDomain, getDatabaseInfo } from './dbosCloudApi';
import { validateCredentials } from './userFlows';

const TTDBG_CONFIG_SECTION = "dbos-ttdbg";
const PROV_DB_HOST = "prov_db_host";
const PROV_DB_PORT = "prov_db_port";
const PROV_DB_DATABASE = "prov_db_database";
const PROV_DB_USER = "prov_db_user";
const DEBUG_PROXY_PORT = "debug_proxy_port";
const DEBUG_PRE_LAUNCH_TASK = "debug_pre_launch_task";

export interface DbosDebugConfig {
  user: string;
  database: string;
  password: string | (() => Promise<string | undefined>);
  port?: number;
  host: string;
  appName?: string;
}

export async function getDebugConfigFromDbosCloud(appName: string, credentials: DbosCloudCredentials): Promise<Omit<DbosDebugConfig, 'password'> | undefined> {
  if (!validateCredentials(credentials)) { return undefined; }

  const app = await getAppInfo(appName, credentials);
  const db = await getDatabaseInfo(app.PostgresInstanceName, credentials);
  const cloudConfig = {
    host: db.HostName,
    port: db.Port,
    database: app.ApplicationDatabaseName,
    user: db.DatabaseUsername,
    appName: app.Name,
  };
  logger.debug("getCloudConfigFromVSCodeConfig", { appName, credentials, cloudConfig });
  return cloudConfig;
}

function cfgString(value: string | undefined) {
  return value?.length ?? 0 > 0 ? value : undefined;
}

function getDebugConfigFromVSCode(folder: vscode.WorkspaceFolder): Partial<Omit<DbosDebugConfig, 'password' | 'appName' | 'appId'>> {
  const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);

  const host = cfg.get<string | undefined>(PROV_DB_HOST, undefined);
  const port = cfg.get<number | undefined>(PROV_DB_PORT, undefined);
  const database = cfg.get<string | undefined>(PROV_DB_DATABASE, undefined);
  const user = cfg.get<string | undefined>(PROV_DB_USER, undefined);

  const cloudConfig = {
    host: cfgString(host),
    port: port !== 0 ? port : undefined,
    database: cfgString(database),
    user: cfgString(user),
  };
  logger.debug("getCloudConfigFromVSCodeConfig", { folder: folder.uri.fsPath, cloudConfig });
  return cloudConfig;
}

function domainSecretKey(domain: string) {
  return `dbos-ttdbg:domain:${domain}`;
}

function databaseSecretKey(db: Pick<DbosDebugConfig, 'user' | 'host' | 'port' | 'database'>) {
  return `dbos-ttdbg:database:${db.user}@${db.host}:${db.port ?? 5432}/${db.database}`;
}

const databaseSetKey = `dbos-ttdbg:databases`;

export class Configuration {
  constructor(private readonly secrets: vscode.SecretStorage) { }

  async getStoredCloudCredentials(domain?: string | DbosCloudDomain): Promise<DbosCloudCredentials | undefined> {
    const { cloudDomain } = getCloudDomain(domain);
    const secretKey = domainSecretKey(cloudDomain);
    const json = await this.secrets.get(secretKey);
    return json ? JSON.parse(json) as DbosCloudCredentials : undefined;
  }

  async cloudLogin(domain?: string | DbosCloudDomain) {
    const { cloudDomain } = getCloudDomain(domain);
    const credentials = await authenticate(cloudDomain);
    if (credentials) {
      const secretKey = domainSecretKey(cloudDomain);
      await this.secrets.store(secretKey, JSON.stringify(credentials));
    }
    return credentials;
  }

  async deleteStoredCloudCredentials(domain?: string | DbosCloudDomain) {
    const { cloudDomain } = getCloudDomain(domain);
    const secretKey = domainSecretKey(cloudDomain);
    await this.secrets.delete(secretKey);
    logger.debug("Deleted DBOS Cloud credentials", { cloudDomain });
  }

  async getDebugConfig(folder: vscode.WorkspaceFolder, credentials: DbosCloudCredentials): Promise<DbosDebugConfig> {
    const cloudConfig = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window },
      async (): Promise<Omit<DbosDebugConfig, 'password'> | undefined> => {
        const packageName = await getPackageName(folder);
        if (!packageName) { return undefined; }

        const cloudConfig = await getDebugConfigFromDbosCloud(packageName, credentials);
        const localConfig = getDebugConfigFromVSCode(folder);

        const host = localConfig.host ?? cloudConfig?.host;
        const port = localConfig.port ?? cloudConfig?.port ?? 5432;
        const database = localConfig.database ?? cloudConfig?.database;
        const user = localConfig.user ?? cloudConfig?.user;
        const appName = cloudConfig?.appName;
        if (!host || !database || !user) { return undefined; }

        return <Omit<DbosDebugConfig, 'password'>>{ host, port, database: `${database}_dbos_prov`, user, appName };
      }
    );

    if (cloudConfig) {
      logger.debug("getCloudConfig", { folder: folder.uri.fsPath, cloudConfig });
      return { ...cloudConfig, password: () => this.#getAppDatabasePassword(cloudConfig) };
    } else {
      throw new Error("Invalid CloudConfig", { cause: { folder: folder.uri.fsPath, credentials } });
    }
  }

  getProxyPort(folder: vscode.WorkspaceFolder): number {
    const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
    return cfg.get<number>(DEBUG_PROXY_PORT, 2345);
  }

  getPreLaunchTask(folder: vscode.WorkspaceFolder) {
    const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
    return cfgString(cfg.get<string | undefined>(DEBUG_PRE_LAUNCH_TASK, undefined));
  }

  async #getAppDatabaseKeys(): Promise<Set<string>> {
    const set = await this.secrets.get(databaseSetKey);
    return set
      ? new Set(JSON.parse(set))
      : new Set<string>();
  }

  async #updateAppDatabaseKeys(key: string): Promise<void> {
    const set = await this.#getAppDatabaseKeys();
    set.add(key);
    await this.secrets.store(databaseSetKey, JSON.stringify(Array.from(set)));
  }

  async #getAppDatabasePassword(debugConfig: Pick<DbosDebugConfig, 'user' | 'host' | 'port' | 'database'>): Promise<string | undefined> {
    const key = databaseSecretKey(debugConfig);
    let password = await this.secrets.get(key);
    if (!password) {
      password = await vscode.window.showInputBox({
        prompt: "Enter application database password",
        password: true,
      });
      if (password) {
        await this.#updateAppDatabaseKeys(key);
        await this.secrets.store(key, password);
      }
    }
    return password;
  }

  async deleteStoredAppDatabasePassword(debugConfig: Pick<DbosDebugConfig, 'user' | 'host' | 'port' | 'database'>): Promise<void> {
    const key = databaseSecretKey(debugConfig);
    await this.secrets.delete(key);
    logger.debug("Deleted DBOS database credentials", { debugConfig, key });
  }

  async deletePasswords() {
    await this.deleteStoredCloudCredentials();

    const set = await this.#getAppDatabaseKeys();
    for (const key of set) {
      await this.secrets.delete(key);
      logger.debug("Deleted DBOS database credentials", { key });
    }
    await this.secrets.delete(databaseSetKey);
  }
}