import * as vscode from 'vscode';
// import { exists } from './utility';
// import { logger } from './extension';
// import { type DbosCloudApp, type DbosCloudCredentials, type DbosCloudDomain, authenticate, getApp, getCloudDomain, getDbInstance, getDbProxyRole, isUnauthorized } from './dbosCloudApi';
// import { validateCredentials } from './validateCredentials';

const TTDBG_CONFIG_SECTION = "dbos-ttdbg";
// const PROV_DB_HOST = "prov_db_host";
// const PROV_DB_PORT = "prov_db_port";
// const PROV_DB_DATABASE = "prov_db_database";
// const PROV_DB_USER = "prov_db_user";
const DEBUG_PROXY_PORT = "debug_proxy_port";
// const DEBUG_PRE_LAUNCH_TASK = "debug_pre_launch_task";
const DEBUG_PROXY_PATH = "debug_proxy_path";
const DEBUG_PROXY_PRERELEASE = "debug_proxy_prerelease";

// const DEBUG_PROXY_LAUNCH = "debug_proxy_launch";

// export function getLaunchProxyConfig() {
//   const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION);
//   return cfg.get<boolean>(DEBUG_PROXY_LAUNCH, true);
// }

export class Configuration {

    static getProxyPath(folder?: vscode.WorkspaceFolder) {
        const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
        const proxyPath = cfg.get<string>(DEBUG_PROXY_PATH);
        return proxyPath ? vscode.Uri.file(proxyPath) : undefined;
    }

    static getProxyPrerelease(folder?: vscode.WorkspaceFolder) {
        const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
        return cfg.get<boolean>(DEBUG_PROXY_PRERELEASE) ?? false;
    }

    static getProxyPort(folder?: vscode.WorkspaceFolder): number {
        const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
        return cfg.get<number>(DEBUG_PROXY_PORT, 2345);
    }
}

// export interface DbosDebugConfig {
//   user: string;
//   database: string;
//   password: string | (() => Promise<string | undefined>);
//   port?: number;
//   host: string;
//   appName?: string;
// }

// export async function getDebugConfigFromDbosCloud(app: string | DbosCloudApp, credentials: DbosCloudCredentials): Promise<Omit<DbosDebugConfig, 'password'> & { dbInstance: string } | undefined> {
//   if (!validateCredentials(credentials)) { return undefined; }

//   if (typeof app === 'string') {
//     const $app = await getApp(app, credentials);
//     if (isUnauthorized($app)) { return undefined; }
//     app = $app;
//   }
//   const db = await getDbInstance(app.PostgresInstanceName, credentials);
//   if (isUnauthorized(db)) { return undefined; }
//   const cloudConfig = {
//     host: db.HostName,
//     port: db.Port,
//     database: app.ApplicationDatabaseName,
//     user: db.DatabaseUsername,
//     appName: app.Name,
//     dbInstance: app.PostgresInstanceName,
//   };
//   logger.debug("getCloudConfigFromVSCodeConfig", { app, credentials, cloudConfig });
//   return cloudConfig;
// }

// function cfgString(value: string | undefined) {
//   return value?.length ?? 0 > 0 ? value : undefined;
// }

// function getDebugConfigFromVSCode(folder: vscode.WorkspaceFolder): Partial<Omit<DbosDebugConfig, 'password' | 'appName' | 'appId'>> {
//   const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);

//   const host = cfg.get<string | undefined>(PROV_DB_HOST, undefined);
//   const port = cfg.get<number | undefined>(PROV_DB_PORT, undefined);
//   const database = cfg.get<string | undefined>(PROV_DB_DATABASE, undefined);
//   const user = cfg.get<string | undefined>(PROV_DB_USER, undefined);

//   const cloudConfig = {
//     host: cfgString(host),
//     port: port !== 0 ? port : undefined,
//     database: cfgString(database),
//     user: cfgString(user),
//   };
//   logger.debug("getCloudConfigFromVSCodeConfig", { folder: folder.uri.fsPath, cloudConfig });
//   return cloudConfig;
// }

// function domainSecretKey(domain: string) {
//   return `dbos-ttdbg:domain:${domain}`;
// }

// function databaseSecretKey(db: Pick<DbosDebugConfig, 'user' | 'host' | 'port' | 'database'>) {
//   return `dbos-ttdbg:database:${db.user}@${db.host}:${db.port ?? 5432}/${db.database}`;
// }

// const databaseSetKey = `dbos-ttdbg:databases`;
// const appNameKey = `dbos-ttdbg:app-name`;

// export class Configuration {
//   constructor(private readonly secrets: vscode.SecretStorage, private readonly workspaceState: vscode.Memento) { }

//   async getStoredCloudCredentials(domain?: string | DbosCloudDomain): Promise<DbosCloudCredentials | undefined> {
//     const { cloudDomain } = getCloudDomain(domain);
//     const secretKey = domainSecretKey(cloudDomain);
//     const json = await this.secrets.get(secretKey);
//     return json ? JSON.parse(json) as DbosCloudCredentials : undefined;
//   }

//   async cloudLogin(domain?: string | DbosCloudDomain) {
//     const { cloudDomain } = getCloudDomain(domain);
//     const credentials = await authenticate(cloudDomain);
//     if (credentials) {
//       const secretKey = domainSecretKey(cloudDomain);
//       await this.secrets.store(secretKey, JSON.stringify(credentials));
//     }
//     return credentials;
//   }

//   async getCredentials(domain?: string | DbosCloudDomain) {
//     const { cloudDomain } = getCloudDomain(domain);
//     const storedCredentials = await this.getStoredCloudCredentials(cloudDomain);
//     return storedCredentials ?? await this.cloudLogin(cloudDomain);
//   }

//   async deleteStoredCloudCredentials(domain?: string | DbosCloudDomain) {
//     const { cloudDomain } = getCloudDomain(domain);
//     const secretKey = domainSecretKey(cloudDomain);
//     const json = await this.secrets.get(secretKey);
//     if (json) {
//       await this.secrets.delete(secretKey);
//       logger.debug("Deleted DBOS Cloud credentials", { cloudDomain });
//       return true;
//     } else {
//       return false;
//     }
//   }

//   async getDebugConfig(folder: vscode.WorkspaceFolder, credentials: DbosCloudCredentials): Promise<DbosDebugConfig> {
//     return await vscode.window.withProgress(
//       { location: vscode.ProgressLocation.Window },
//       async (): Promise<DbosDebugConfig> => {
//         const packageName = this.getAppName() ?? await getPackageName(folder);
//         if (!packageName) { 
//           throw new Error("Failed to get application name", { cause: { folder: folder.uri.fsPath, credentials } });
//         }

//         const cloudConfig =  await getDebugConfigFromDbosCloud(packageName, credentials);
//         if (cloudConfig === undefined) {
//           throw new Error('failed to get cloud config', { cause: { packageName, credentials } });
//         }
//         const localConfig = getDebugConfigFromVSCode(folder);

//         const host = localConfig.host ?? cloudConfig.host;
//         const port = localConfig.port ?? cloudConfig.port ?? 5432;
//         const database = localConfig.database ?? cloudConfig.database;
//         if (!host || !database) {
//           throw new Error("Failed to get database info", { cause: { folder: folder.uri.fsPath, credentials, host, port, database } });
//         }

//         const role = await getDbProxyRole(cloudConfig.dbInstance, credentials);
//         if (isUnauthorized(role)) {
//           throw new Error("Unable to retrieve DB proxy role", { cause: { credentials } });
//         }

//         return {
//           host,
//           port,
//           database: `${database}_dbos_prov`,
//           user: role.RoleName,
//           password: role.Secret,
//           appName: cloudConfig.appName
//         };
//       }
//     );
//   }

//   getProxyPort(folder: vscode.WorkspaceFolder): number {
//     const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
//     return cfg.get<number>(DEBUG_PROXY_PORT, 2345);
//   }

//   getPreLaunchTask(folder: vscode.WorkspaceFolder) {
//     const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
//     return cfgString(cfg.get<string | undefined>(DEBUG_PRE_LAUNCH_TASK, undefined));
//   }

//   async setAppName(appName?: string) {
//     await this.workspaceState.update(appNameKey, appName);
//   }

//   getAppName() {
//     return this.workspaceState.get<string>(appNameKey);
//   }
// }

// async function getPackageName(folder: vscode.WorkspaceFolder): Promise<string | undefined> {
//   const packageJsonUri = vscode.Uri.joinPath(folder.uri, "package.json");
//   if (!await exists(packageJsonUri)) { return undefined; }

//   try {
//     const packageJsonBuffer = await vscode.workspace.fs.readFile(packageJsonUri);
//     const packageJsonText = new TextDecoder().decode(packageJsonBuffer);
//     const packageJson = JSON.parse(packageJsonText);
//     return packageJson.name;
//   } catch (e) {
//     logger.error("getPackageName", e);
//     return undefined;
//   }
// }
