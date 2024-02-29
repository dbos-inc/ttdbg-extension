import * as vscode from 'vscode';
import { isExecFileError } from './utils';
import { logger } from './extension';
import { dbos_cloud_app_status, dbos_cloud_db_status } from './cloudCli';
import { startInvalidCredentialsFlow } from './commands';

const TTDBG_CONFIG_SECTION = "dbos-ttdbg";
const PROV_DB_HOST = "prov_db_host";
const PROV_DB_PORT = "prov_db_port";
const PROV_DB_DATABASE = "prov_db_database";
const PROV_DB_USER = "prov_db_user";
const DEBUG_PROXY_PORT = "debug_proxy_port";

export interface CloudConfig {
    user?: string;
    database?: string;
    password?: string | (() => Promise<string | undefined>);
    port?: number;
    host?: string;
    appName?: string;
    appId?: string;
}

async function getCloudConfigFromDbosCloud(folder: vscode.WorkspaceFolder): Promise<CloudConfig | undefined> {
    try {
        const app = await dbos_cloud_app_status(folder);
        const db = await dbos_cloud_db_status(folder, app.PostgresInstanceName);
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
                return undefined;
            }
        }
        throw e;
    }
}

function getCloudConfigFromVSCodeConfig(folder: vscode.WorkspaceFolder): CloudConfig {
    const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);

    const host = cfg.get<string>(PROV_DB_HOST);
    const port = cfg.get<number>(PROV_DB_PORT);
    const database = cfg.get<string>(PROV_DB_DATABASE);
    const user = cfg.get<string>(PROV_DB_USER);

    return {
        host: host?.length ?? 0 > 0 ? host : undefined,
        port: port !== 0 ? port : undefined,
        database: database?.length ?? 0 > 0 ? database : undefined,
        user: user?.length ?? 0 > 0 ? user : undefined,
    };
}

export class Configuration {
    constructor(private readonly secrets: vscode.SecretStorage) { }

    async getCloudConfig(folder: vscode.WorkspaceFolder): Promise<CloudConfig | undefined> {
        const cloudConfig = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window },
            async () => {
                const dbosConfig = await getCloudConfigFromDbosCloud(folder);
                const localConfig = getCloudConfigFromVSCodeConfig(folder);

                return <CloudConfig>{ 
                    host: localConfig.host ?? dbosConfig?.host, 
                    port: localConfig.port ?? dbosConfig?.port ?? 5432, 
                    database: localConfig.database ?? dbosConfig?.database, 
                    user: localConfig.user ?? dbosConfig?.user, 
                    appName: localConfig.appName ?? dbosConfig?.appName,
                    appId: localConfig.appId ?? dbosConfig?.appId,                    
                };
            });

        if (cloudConfig.host && cloudConfig.database && cloudConfig.user) {
            return { ...cloudConfig, password: () => this.#getPassword(folder) };
        } else {
            startInvalidCredentialsFlow(folder).catch(e => logger.error("startInvalidCredentialsFlow", e));
            return undefined;
        }
    }

    get proxyPort(): number {
        const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION);
        return cfg.get<number>(DEBUG_PROXY_PORT, 2345);
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


