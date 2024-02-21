import * as vscode from 'vscode';
import { ClientConfig } from 'pg';
import * as fs from 'node:fs/promises';
import { execFile, exists } from './utils';
import { logger } from './extension';

const TTDBG_CONFIG_SECTION = "dbos-ttdbg";
const PROV_DB_HOST = "prov_db_host";
const PROV_DB_PORT = "prov_db_port";
const PROV_DB_DATABASE = "prov_db_database";
const PROV_DB_USER = "prov_db_user";
const DEBUG_PROXY_PORT = "debug_proxy_port";

async function dbos_cloud_app_get(folder: vscode.WorkspaceFolder) {
    const { stdout } = await execFile("npx", ["dbos-cloud", "applications", "get", "--json"], {
        cwd: folder.uri.fsPath,
    });
    return JSON.parse(stdout) as {
        Name: string;
        ID: string;
        PostgresInstanceName: string;
        ApplicationDatabaseName: string;
        Status: string;
        Version: string;
    };
}

async function dbos_cloud_userdb_status(folder: vscode.WorkspaceFolder, databaseName: string) {
    const { stdout } = await execFile("npx", ["dbos-cloud", "userdb", "status", databaseName, "--json"], {
        cwd: folder.uri.fsPath,
    });
    return JSON.parse(stdout) as {
        PostgresInstanceName: string;
        HostName: string;
        Status: string;
        Port: number;
        AdminUsername: string;
    };
}

interface ExecFileError {
    cmd: string;
    code: number;
    killed: boolean;
    stdout: string;
    stderr: string;
    message: string;
    stack: string;
}

function isExecFileError(e: unknown): e is ExecFileError {
    if (e instanceof Error) {
        return "stdout" in e && "stderr" in e && "cmd" in e;
    }
    return false;
}

async function getDbConfigFromDbosCloud(folder: vscode.WorkspaceFolder): Promise<ClientConfig> {
    try {
        const app = await dbos_cloud_app_get(folder);
        const db = await dbos_cloud_userdb_status(folder, app.PostgresInstanceName);
        return {
            host: db.HostName,
            port: db.Port,
            database: app.ApplicationDatabaseName + "_dbos_prov",
            user: db.AdminUsername
        };
    } catch (e) {
        if (isExecFileError(e)) {
            if (e.stdout.trim().endsWith("Error: not logged in")) {
                vscode.window.showErrorMessage("Not logged in to DBOS Cloud");
            }
        }

        logger.error("getDbosCloudInfo", e);
        return {};
    }
}

async function getDbConfigFromVSCodeConfig(folder: vscode.WorkspaceFolder): Promise<ClientConfig> {
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

async function getUserName(folder: vscode.WorkspaceFolder) {
    const credPath = vscode.Uri.joinPath(folder.uri, ".dbos/credentials");
    if (!await exists(credPath)) { return undefined; }

    try {
        const creds = await fs.readFile(credPath.fsPath, "utf-8").catch(() => "");
        const { userName } = JSON.parse(creds) as { userName: string };
        return userName;
    } catch (e) {
        logger.error("getUserName", e);
        return undefined;
    }
}

export class Configuration {
    constructor(private readonly secrets: vscode.SecretStorage) { }

    async getProvDbConfig(folder: vscode.WorkspaceFolder): Promise<ClientConfig> {

        const cloudConfig = await getDbConfigFromDbosCloud(folder);
        const localConfig = await getDbConfigFromVSCodeConfig(folder);

        return {
            host: localConfig.host ?? cloudConfig.host,
            port: localConfig.port ?? cloudConfig.port,
            database: localConfig.database ?? cloudConfig.database,
            user: localConfig.user ?? cloudConfig.user,
            password: () => this.#getPassword(folder),
            ssl: {
                rejectUnauthorized: false,
            }
        };
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
                prompt: "Enter provenance database password",
                password: true,
            });
            if (!password) {
                throw new Error('Provenance database password is required');
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
