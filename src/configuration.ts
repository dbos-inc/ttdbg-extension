import * as vscode from 'vscode';
import { exists, getPackageName, isExecFileError } from './utils';
import { logger } from './extension';
import { startInvalidCredentialsFlow } from './commands';
import { DbosCloudCredentials, authenticate, getAppInfo, getCloudOptions, getDatabaseInfo, isTokenExpired } from './dbosCloudApi';

const TTDBG_CONFIG_SECTION = "dbos-ttdbg";
const PROV_DB_HOST = "prov_db_host";
const PROV_DB_PORT = "prov_db_port";
const PROV_DB_DATABASE = "prov_db_database";
const PROV_DB_USER = "prov_db_user";
const DEBUG_PROXY_PORT = "debug_proxy_port";
const DEBUG_PRE_LAUNCH_TASK = "debug_pre_launch_task";

export interface CloudConfig {
  user?: string;
  database?: string;
  password?: string | (() => Promise<string | undefined>);
  port?: number;
  host?: string;
  appName?: string;
  appId?: string;
}

async function getCloudConfigFromDbosCloud(appName: string, credentials: DbosCloudCredentials): Promise<CloudConfig > {
  try {
    const app = await getAppInfo(appName, credentials);
    const db = await getDatabaseInfo(app.PostgresInstanceName, credentials);
    return {
      host: db.HostName,
      port: db.Port,
      database: app.ApplicationDatabaseName + "_dbos_prov",
      user: db.AdminUsername,
      appName: app.Name,
      appId: app.ID,
    };
  } catch (e) {
    if (isExecFileError(e)) {
      if (e.stdout.includes("Error: not logged in") || e.stdout.includes("Error: Login expired")) {
        return {};
      }
    }
    throw e;
  }
}

function cfgString(value: string | undefined) {
  return value?.length ?? 0 > 0 ? value : undefined;
}

function getCloudConfigFromVSCodeConfig(folder: vscode.WorkspaceFolder): CloudConfig {
  const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);

  const host = cfg.get<string | undefined>(PROV_DB_HOST, undefined);
  const port = cfg.get<number | undefined>(PROV_DB_PORT, undefined);
  const database = cfg.get<string | undefined>(PROV_DB_DATABASE, undefined);
  const user = cfg.get<string | undefined>(PROV_DB_USER, undefined);

  return {
    host: cfgString(host),
    port: port !== 0 ? port : undefined,
    database: cfgString(database),
    user: cfgString(user),
  };
}

function domainSecretKey(domain: string) { return `dbos-ttdbg:domain:${domain}`; }

export class Configuration {
  constructor(private readonly secrets: vscode.SecretStorage) { }

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

  async #getCredentials(domain: string) {
    const storedCredentials = await this.#getStoredCredentials(domain);
    if (storedCredentials) {
      return storedCredentials;
    }
    const credentials = await authenticate(domain);
    if (credentials) {
      const secretKey = domainSecretKey(domain);
      await this.secrets.store(secretKey, JSON.stringify(credentials));
    }
    return credentials;
  }

  async authenticate(host?: string) {
    const { cloudDomain } = getCloudOptions(host);
    this.#getCredentials(cloudDomain);
  }

  async getCloudConfig(folder: vscode.WorkspaceFolder, host?: string): Promise<CloudConfig | undefined> {
    const { cloudDomain } = getCloudOptions(host);
    const cloudConfig = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window },
      async () => {
        const packageName = await getPackageName(folder);
        if (!packageName) { return {}; }
        const credentials = await this.#getCredentials(cloudDomain);
        if (!credentials) { return {}; }

        const dbosConfig = await getCloudConfigFromDbosCloud(packageName, credentials);
        const localConfig = getCloudConfigFromVSCodeConfig(folder);

        return <CloudConfig>{
          host: localConfig.host ?? dbosConfig.host,
          port: localConfig.port ?? dbosConfig.port ?? 5432,
          database: localConfig.database ?? dbosConfig.database,
          user: localConfig.user ?? dbosConfig.user,
          appName: localConfig.appName ?? dbosConfig.appName,
          appId: localConfig.appId ?? dbosConfig.appId,
        };
      });

    if (cloudConfig.host && cloudConfig.database && cloudConfig.user) {
      return { ...cloudConfig, password: () => this.#getPassword(folder) };
    } else {
      startInvalidCredentialsFlow(folder).catch(e => logger.error("startInvalidCredentialsFlow", e));
      return undefined;
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

  #getPasswordKey(folder: vscode.WorkspaceFolder): string {
    return `${TTDBG_CONFIG_SECTION}.prov_db_password.${folder.uri.fsPath}`;
  }

  async #getPassword(folder: vscode.WorkspaceFolder): Promise<string | undefined> {
    const passwordKey = this.#getPasswordKey(folder);
    let password = await this.secrets.get(passwordKey);
    if (!password) {
      password = await vscode.window.showInputBox({
        prompt: "Enter application database password",
        password: true,
      });
      if (password) {
        await this.secrets.store(passwordKey, password);
      }
    }
    return password;
  }

  async deletePasswords() {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const passwordKey = this.#getPasswordKey(folder);
      await this.secrets.delete(passwordKey);
    }
  }
}
