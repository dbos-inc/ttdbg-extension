import * as vscode from 'vscode';
import { getPackageName, isExecFileError } from './utils';
import { logger } from './extension';
import { DbosCloudCredentials, DbosCloudDatabase, authenticate, getAppInfo, getCloudOptions, getDatabaseInfo } from './dbosCloudApi';

const TTDBG_CONFIG_SECTION = "dbos-ttdbg";
const PROV_DB_HOST = "prov_db_host";
const PROV_DB_PORT = "prov_db_port";
const PROV_DB_DATABASE = "prov_db_database";
const PROV_DB_USER = "prov_db_user";
const DEBUG_PROXY_PORT = "debug_proxy_port";
const DEBUG_PRE_LAUNCH_TASK = "debug_pre_launch_task";

export interface CloudConfig {
  user: string;
  database: string;
  password: string | (() => Promise<string | undefined>);
  port?: number;
  host: string;
  appName?: string;
}

async function getCloudConfigFromDbosCloud(appName: string, credentials: DbosCloudCredentials): Promise<Omit<CloudConfig, 'password'> | undefined> {
  try {
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
  } catch (e) {
    if (isExecFileError(e)) {
      if (e.stdout.includes("Error: not logged in") || e.stdout.includes("Error: Login expired")) {
        return undefined;
      }
    }
    throw e;
  }
}

function cfgString(value: string | undefined) {
  return value?.length ?? 0 > 0 ? value : undefined;
}

function getCloudConfigFromVSCodeConfig(folder: vscode.WorkspaceFolder): Partial<Omit<CloudConfig, 'password' | 'appName' | 'appId'>> {
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

function databaseSecretKey(db: Pick<CloudConfig, 'user' | 'host' | 'port' | 'database'>) {
  return `dbos-ttdbg:database:${db.user}@${db.host}:${db.port ?? 5432}/${db.database}`;
}

const databaseSetKey = `dbos-ttdbg:databases`;

export class Configuration {
  constructor(private readonly secrets: vscode.SecretStorage) { }

  async getStoredCloudCredentials(host?: string): Promise<DbosCloudCredentials | undefined> {
    const { cloudDomain } = getCloudOptions(host);
    const secretKey = domainSecretKey(cloudDomain);
    const json = await this.secrets.get(secretKey);
    return json ? JSON.parse(json) as DbosCloudCredentials : undefined;
  }

  async cloudLogin(host?: string) {
    const { cloudDomain } = getCloudOptions(host);
    const credentials = await authenticate(cloudDomain);
    if (credentials) {
      const secretKey = domainSecretKey(cloudDomain);
      await this.secrets.store(secretKey, JSON.stringify(credentials));
    }
    return credentials;
  }

  async getCloudConfig(folder: vscode.WorkspaceFolder, credentials: DbosCloudCredentials): Promise<CloudConfig> {
    const cloudConfig = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window },
      async (): Promise<Omit<CloudConfig, 'password'> | undefined> => {
        const packageName = await getPackageName(folder);
        if (!packageName) { return undefined; }

        const cloudConfig = await getCloudConfigFromDbosCloud(packageName, credentials);
        const localConfig = getCloudConfigFromVSCodeConfig(folder);

        const host = localConfig.host ?? cloudConfig?.host;
        const port = localConfig.port ?? cloudConfig?.port ?? 5432;
        const database = localConfig.database ?? cloudConfig?.database;
        const user = localConfig.user ?? cloudConfig?.user;
        const appName = cloudConfig?.appName;
        if (!host || !database || !user) { return undefined; }

        return <Omit<CloudConfig, 'password'>>{ host, port, database: `${database}_dbos_prov`, user, appName };
      }
    );

    if (cloudConfig) {
      logger.debug("getCloudConfig", { folder: folder.uri.fsPath, cloudConfig });
      return { ...cloudConfig, password: () => this.#getPassword(cloudConfig) };
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

  getDebugConfig(folder: vscode.WorkspaceFolder, workflowID: string) {
    const debugConfigs = vscode.workspace.getConfiguration("launch", folder).get('configurations') as ReadonlyArray<vscode.DebugConfiguration> | undefined;
    for (const config of debugConfigs ?? []) {
      const command = config["command"] as string | undefined;
      if (command && command.includes("npx dbos-sdk debug")) {
        const newCommand = command.replace("${command:dbos-ttdbg.pick-workflow-id}", `${workflowID}`);
        return { ...config, command: newCommand };
      }
    }

    return <vscode.DebugConfiguration>{
      name: `Time-Travel Debug ${workflowID}`,
      type: 'node-terminal',
      request: 'launch',
      command: `npx dbos-sdk debug -x http://localhost:${this.getProxyPort(folder)} -u ${workflowID}`,
      preLaunchTask: this.getPreLaunchTask(folder),
    };
  }

  async #getDatabaseKeySet(): Promise<Set<string>> {
    const set = await this.secrets.get(databaseSetKey);
    return set
      ? new Set(JSON.parse(set))
      : new Set<string>();
  }

  async #updateDatabaseKeySet(key: string): Promise<void> {
    const set = await this.#getDatabaseKeySet();
    set.add(key);
    await this.secrets.store(databaseSetKey, JSON.stringify(Array.from(set)));
  }

  async #getPassword(cloudConfig: Pick<CloudConfig, 'user' | 'host' | 'port' | 'database'>): Promise<string | undefined> {
    const passwordKey = databaseSecretKey(cloudConfig);
    let password = await this.secrets.get(passwordKey);
    if (!password) {
      password = await vscode.window.showInputBox({
        prompt: "Enter application database password",
        password: true,
      });
      if (password) {
        await this.#updateDatabaseKeySet(passwordKey);
        await this.secrets.store(passwordKey, password);
      }
    }
    return password;
  }

  async deletePasswords() {
    const { cloudDomain } = getCloudOptions();
    const secretKey = domainSecretKey(cloudDomain);
    await this.secrets.delete(secretKey);
    logger.debug("Deleted DBOS Cloud credentials", { cloudDomain });

    const set = await this.#getDatabaseKeySet();
    for (const key of set) {
      await this.secrets.delete(key);
      logger.debug("Deleted DBOS database credentials", { key });
    }
    await this.secrets.delete(databaseSetKey);
  }
}