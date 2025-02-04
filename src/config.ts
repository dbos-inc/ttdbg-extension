import * as vscode from 'vscode';
import YAML from "yaml";
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { PoolConfig } from 'pg';

export async function locateDbosConfigFile(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) { return; }

    let _uri = uri.fsPath;
    while (true) {
        const configPath = path.join(_uri, 'dbos-config.yaml');
        const exists = await fs.stat(configPath).then(_ => true, () => false);
        if (exists) {
            return vscode.Uri.file(configPath);
        }
        if (_uri === folder.uri.fsPath) { return undefined; }
        _uri = path.dirname(_uri);
    }
}

interface ConfigFile {
    name?: string;
    language?: string;
    database: {
        hostname?: string;
        port?: number;
        username?: string;
        password?: string;
        connectionTimeoutMillis?: number;
        app_db_name?: string;
        sys_db_name?: string;
        ssl?: boolean;
        ssl_ca?: string;
        app_db_client?: string;
        migrate?: string[];
        rollback?: string[];
        local_suffix?: boolean;
    };
    http?: {
        cors_middleware?: boolean;
        credentials?: boolean;
        allowed_origins?: string[];
    };
    telemetry?: {
        logs?: {
            logLevel?: string;
            silent?: boolean;
            addContextMetadata?: boolean;
        };
        OTLPExporter?: {
            logsEndpoint?: string;
            tracesEndpoint?: string;
        };
    };
    application: object;
    env: Record<string, string>;
    runtimeConfig?: {
        entrypoints: string[];
        port: number;
        admin_port: number;
        start: string[];
        setup: string[];
    };
}

async function loadPackageName(configUri: vscode.Uri): Promise<string> {
    const packageJsonPath = path.join(path.dirname(configUri.fsPath), 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as { name?: string };
    if (!packageJson.name) {
        throw new Error(`name is not set in package.json`);
    }
    return packageJson.name;
}

export interface DbosConfig {
    name: string;
    language?: string;
    poolConfig: PoolConfig;
    appDatabase: string;
    sysDatabase: string;
    runtime?: {
        entrypoints: string[];
        port: number;
        admin_port: number;
        start: string[];
        setup: string[];
    };
}

export async function loadConfigFile(configUri: vscode.Uri): Promise<DbosConfig> {
    try {
        const configContent = await fs.readFile(configUri.fsPath, 'utf-8');
        const interpolatedContent = substituteEnvVars(configContent);
        const configFile = YAML.parse(interpolatedContent) as ConfigFile;

        const appName = configFile.name ?? await loadPackageName(configUri);
        const language = configFile.language;
        const runtimeConfig = configFile.runtimeConfig;

        const databaseConnection = await loadDatabaseConnection(configUri);
        const hostName = configFile.database.hostname ?? databaseConnection?.hostname ?? "localhost";
        const port = configFile.database.port ?? databaseConnection?.port ?? 5432;
        const userName = configFile.database.username ?? databaseConnection?.username ?? "postgres";
        const password = configFile.database.password ?? databaseConnection?.password ?? process.env.PGPASSWORD ?? "dbos";
        const timeout = configFile.database.connectionTimeoutMillis ?? 3000;
        const localSuffix = configFile.database.local_suffix ?? databaseConnection?.local_suffix ?? false;
        const appDatabase = getAppDbName(configFile.database.app_db_name, appName, localSuffix);
        const sysDatabase = configFile.database.sys_db_name ?? `${appDatabase}_dbos_sys`;
        const ssl = await getSsl(configFile.database.ssl, configFile.database.ssl_ca, hostName);

        const poolConfig: PoolConfig = {
            host: hostName,
            port,
            user: userName,
            password,
            connectionTimeoutMillis: timeout,
            ssl,
        };

        return {
            name: appName,
            language,
            runtime: runtimeConfig,
            appDatabase,
            sysDatabase,
            poolConfig,
        }
    } catch (e) {
        if (e instanceof Error) {
            throw new Error(`Failed to load config from ${configUri.fsPath}: ${e.message}`);
        } else {
            throw e;
        }
    }

    function substituteEnvVars(content: string): string {
        const regex = /\${([^}]+)}/g; // Regex to match ${VAR_NAME} style placeholders
        return content.replace(regex, (_, g1: string) => {
            return process.env[g1] || '""'; // If the env variable is not set, return an empty string.
        });
    }

    function getAppDbName(dbName: string | undefined, appName: string, local_suffix: boolean) {
        if (!dbName) {
            dbName = appName.toLowerCase().replaceAll("-", "_");
            if (dbName.match(/^\d/)) {
                dbName = `_${dbName}`;
            } 
        }
        return local_suffix ? `${dbName}_local` : dbName;
    }

    async function getSsl(ssl: boolean | undefined, ssl_ca: string | undefined, host: string) {
        if (ssl === false) { 
            return false; 
        }
        if (ssl_ca) { 
            const ca = await fs.readFile(ssl_ca);
            return { ca: [ca], rejectUnauthorized: true };
        }
        if (ssl === undefined && (host === "localhost" || host === "127.0.0.1")) {
            return false;
        }
        return { rejectUnauthorized: false };
    }
}

interface DatabaseConnection {
    hostname?: string;
    port?: number;
    username?: string;
    password?: string;
    local_suffix?: boolean;
}

async function loadDatabaseConnection(configUri: vscode.Uri): Promise<DatabaseConnection | undefined> {
    try {
        const dirName = path.dirname(configUri.fsPath);
        const filePath = path.join(dirName, '.dbos', 'db_connection');
        const contents = await fs.readFile(filePath, 'utf8');
        return JSON.parse(contents) as DatabaseConnection;
    } catch (e) {
        return {};
    }
}