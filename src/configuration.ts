import * as vscode from 'vscode';
import { SpawnOptions, spawn as cpSpawn } from "child_process";
import { ClientConfig } from 'pg';
import { execFile, exists } from './utils';
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

    const cts = new vscode.CancellationTokenSource();
    const loginProc = cpSpawn("npx", ["dbos-cloud", "login"], { cwd: folder.uri.fsPath });
    const userCodeEmitter = new vscode.EventEmitter<string>();

    const regexLoginUrl = /Login URL: (http.*\/activate\?user_code=([A-Z][A-Z][A-Z][A-Z]-[A-Z][A-Z][A-Z][A-Z]))/;
    const regexSuccessfulLogin = /Successfully logged in as (.*)!/;

    try {
        const ctsPromise = new Promise<void>(resolve => {
            cts.token.onCancellationRequested(() => resolve());
        });

        loginProc.on('exit', () => { logger.info("dbos-cloud login on exit"); cts.cancel(); });
        loginProc.on('close', () => { logger.info("dbos-cloud login on close"); cts.cancel(); });
        loginProc.on('error', err => { logger.error("dbos-cloud login on error", err); cts.cancel(); });

        loginProc.stdout.on("data", async (buffer: Buffer) => {
            const data = buffer.toString().trim();
            logger.info("dbos-cloud login stdout on data", { data });

            const loginUrlMatch = regexLoginUrl.exec(data);
            if (loginUrlMatch && loginUrlMatch.length === 3) {
                const [, loginUrl, userCode] = loginUrlMatch;
                logger.info("dbos-cloud login url", { loginUri: loginUrl, userCode });
                userCodeEmitter.fire(userCode);

                const openResult = await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
                if (!openResult) {
                    logger.error("dbos_cloud_login openExternal failed", { loginUri: loginUrl, userCode });
                    cts.cancel();
                }
            }

            const successfulLoginMatch = regexSuccessfulLogin.exec(data);
            if (successfulLoginMatch && successfulLoginMatch.length === 2) {
                const [, user] = successfulLoginMatch;
                logger.info("dbos-cloud login successful", { user });
                vscode.window.showInformationMessage(`Successfully logged in to DBOS Cloud as ${user}`);
            }
        });

        await vscode.window.withProgress({
            cancellable: true,
            location: vscode.ProgressLocation.Notification,
            title: "Launching browser to log into DBOS Cloud"
        }, async (progress, token) => {
            userCodeEmitter.event(userCode => {
                progress.report({ message: `\nUser code: ${userCode}` });
            });

            token.onCancellationRequested(() => cts.cancel());
            await ctsPromise;
        });
    } finally {
        loginProc.stdout.removeAllListeners();
        loginProc.stderr.removeAllListeners();
        loginProc.removeAllListeners();

        cts.dispose();
        userCodeEmitter.dispose();

        const killed = loginProc.killed;
        const killResult = loginProc.kill();
        logger.info("dbos_cloud_login exit", { killed, killResult });
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
        if (isExecFileError(e) && e.stdout.includes("Error: not logged in")) {
            return undefined;
        } else {
            throw e;
        }
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

    // TODO: Register support
    const result = await vscode.window.showWarningMessage(
        "Invalid DBOS Cloud credentials",
        "Login", "Cancel");

    if (result === "Login") {
        await dbos_cloud_login(folder);
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
