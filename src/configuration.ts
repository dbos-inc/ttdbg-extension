import * as vscode from 'vscode';
import { spawn } from "child_process";
import { ClientConfig } from 'pg';
import { execFile } from './utils';
import { logger } from './extension';

const TTDBG_CONFIG_SECTION = "dbos-ttdbg";
const PROV_DB_HOST = "prov_db_host";
const PROV_DB_PORT = "prov_db_port";
const PROV_DB_DATABASE = "prov_db_database";
const PROV_DB_USER = "prov_db_user";
const DEBUG_PROXY_PORT = "debug_proxy_port";

export interface DbosCloudApp {
    Name: string;
    ID: string;
    PostgresInstanceName: string;
    ApplicationDatabaseName: string;
    Status: string;
    Version: string;
}

export interface DbosCloudDatabase {
    PostgresInstanceName: string;
    HostName: string;
    Status: string;
    Port: number;
    AdminUsername: string;
}

async function dbos_cloud_cli<T>(folder: vscode.WorkspaceFolder, ...args: string[]): Promise<T> {
    const { stdout } = await execFile("npx", ["dbos-cloud", ...args, "--json"], {
        cwd: folder.uri.fsPath,
    });
    return JSON.parse(stdout) as T;
}

async function dbos_cloud_app_status(folder: vscode.WorkspaceFolder) {
    return dbos_cloud_cli<DbosCloudApp>(folder, "application", "status");
}

async function dbos_cloud_db_status(folder: vscode.WorkspaceFolder, databaseName: string) {
    return dbos_cloud_cli<DbosCloudDatabase>(folder, "database", "status", databaseName);
}


export async function dbos_cloud_login(folder: vscode.WorkspaceFolder) {
    logger.info("dbos_cloud_login", { folder: folder.uri.fsPath });

    const proc = spawn(
        "npx",
        ["dbos-cloud", "login" ],
        { cwd: folder.uri.fsPath, });

    try {
        const killEvent = new vscode.EventEmitter<void>();
        const killEventPromise = new Promise<void>(resolve => {
            killEvent.event(() => { resolve(); });
        });

        proc.on("exit", (code, signal) => {
            logger.debug("dbos_cloud on exit", { code, signal, killed: proc.killed });
            killEvent.fire();
        });

        proc.stdout.on("data", async (data: Buffer) => {
            const $data = data.toString().trim();
            logger.debug("dbos_cloud stdout on data", { data: $data });

            const loginUrlMatch = /Login URL: (http.*\/activate\?user_code=([A-Z][A-Z][A-Z][A-Z]-[A-Z][A-Z][A-Z][A-Z]))/.exec($data);
            if (loginUrlMatch && loginUrlMatch.length === 3) {
                const [, loginUri, userCode] = loginUrlMatch;
                logger.info("dbos_cloud Login URL", { loginUri, userCode });

                const result = await vscode.window.showInformationMessage(`Login to DBOS Cloud using user code: ${userCode}?`, "Login via Browser", "Cancel");
                if (result === "Login via Browser") {
                    logger.info("dbos_cloud Login via Browser", { loginUri, userCode });

                    const openResult = await vscode.env.openExternal(vscode.Uri.parse(loginUri));
                    if (openResult) {
                        await vscode.window.withProgress({
                            cancellable: true,
                            location: vscode.ProgressLocation.Notification,
                            title: `Logging into DBOS Cloud with code ${userCode}...`
                        }, async (_, token) => {
                            logger.info("dbos_cloud login cancelled", { loginUri, result: openResult });
                            token.onCancellationRequested(() => killEvent.fire());
                            await killEventPromise;
                        });
                    } else {
                        logger.error("dbos_cloud failed to open external browser", { loginUri });
                        killEvent.fire();
                        vscode.window.showErrorMessage(`Failed to open external browser for ${loginUri}`);
                    }
                } else {
                    logger.info("dbos_cloud login cancelled", { loginUri, result });
                    killEvent.fire();
                }
            }

            const successfulLoginMatch = /Successfully logged in as (.*)!/.exec($data);
            if (successfulLoginMatch && successfulLoginMatch.length === 2) {
                const [, user] = successfulLoginMatch;
                logger.info("dbos_cloud Login Successfully", { user });
                vscode.window.showInformationMessage(`Successfully logged in as ${user}`);
                killEvent.fire();
            }
        });

        await killEventPromise;

    } finally {
        proc.stdout.removeAllListeners();
        proc.stderr.removeAllListeners();
        proc.removeAllListeners();
        proc.kill();
        logger.info("dbos_cloud_login exit", { killed: proc.killed });
    }
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
            if (e.stdout.trim().endsWith("Error: not logged in")) {
                // TODO: initiate login
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
