import * as vscode from 'vscode';
import { ClientConfig } from 'pg';
import { exists, isExecFileError } from './utils';
import { logger } from './extension';
import { dbos_cloud_app_status, dbos_cloud_db_status, dbos_cloud_login } from './cloudCli';

const TTDBG_CONFIG_SECTION = "dbos-ttdbg";
const PROV_DB_HOST = "prov_db_host";
const PROV_DB_PORT = "prov_db_port";
const PROV_DB_DATABASE = "prov_db_database";
const PROV_DB_USER = "prov_db_user";
const DEBUG_PROXY_PORT = "debug_proxy_port";

interface DatabaseConfig {
    host: string | undefined;
    port: number | undefined;
    database: string | undefined;
    user: string | undefined;
}

async function getDbConfigFromDbosCloud(folder: vscode.WorkspaceFolder): Promise<DatabaseConfig | undefined> {
    try {
        const app = await dbos_cloud_app_status(folder);
        const db = await dbos_cloud_db_status(folder, app.PostgresInstanceName);
        return {
            host: db.HostName,
            port: db.Port,
            database: app.ApplicationDatabaseName + "_dbos_prov",
            user: db.AdminUsername
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

function getDbConfigFromVSCodeConfig(folder: vscode.WorkspaceFolder): DatabaseConfig {
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

async function startInvalidCredentialsFlow(folder: vscode.WorkspaceFolder): Promise<void> {
    const credentialsPath = vscode.Uri.joinPath(folder.uri, ".dbos", "credentials");
    const credentialsExists = await exists(credentialsPath);

    const message = credentialsExists
        ? "DBOS Cloud credentials have expired. Please login again."
        : "You need to login to DBOS Cloud.";

    const items = ["Login", "Cancel"];

    // TODO: Register support
    // if (!credentialsExists) { items.unshift("Register"); }

    const result = await vscode.window.showWarningMessage(message, ...items);
    switch (result) {
        // case "Register": break;
        case "Login": 
            await dbos_cloud_login(folder); 
            break;
    }
}

export class Configuration {
    constructor(private readonly secrets: vscode.SecretStorage) { }

    async getProvDbConfig(folder: vscode.WorkspaceFolder): Promise<ClientConfig | undefined> {
        const dbConfig = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window },
            async () => {
                const cloudConfig = await getDbConfigFromDbosCloud(folder);
                const localConfig = getDbConfigFromVSCodeConfig(folder);

                const host = localConfig?.host ?? cloudConfig?.host;
                const port = localConfig?.port ?? cloudConfig?.port ?? 5432;
                const database = localConfig?.database ?? cloudConfig?.database;
                const user = localConfig?.user ?? cloudConfig?.user;

                return { host, port, database, user };
            });

        if (dbConfig.host && dbConfig.database && dbConfig.user) {
            return {
                host: dbConfig.host,
                port: dbConfig.port,
                database: dbConfig.database,
                user: dbConfig.user,
                password: () => this.#getPassword(folder),
                ssl: { rejectUnauthorized: false }
            };
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

    async #getPassword(folder: vscode.WorkspaceFolder): Promise<string> {
        const passwordKey = this.#getPasswordKey(folder);
        let password = await this.secrets.get(passwordKey);
        if (!password) {
            password = await vscode.window.showInputBox({
                prompt: "Enter application database password",
                password: true,
            });
            if (!password) {
                throw new Error('Application database password is required');
            }
            await this.secrets.store(passwordKey, password);
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

