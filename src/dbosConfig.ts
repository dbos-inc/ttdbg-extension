import * as vscode from 'vscode';
import YAML from "yaml";
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { PoolConfig } from 'pg';
import { parse as parsePGConnectionString } from 'pg-connection-string';
import { logger } from './extension';

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

interface DatabaseConfig {
    hostname?: string;
    port?: number;
    username?: string;
    password?: string;
    connectionTimeoutMillis?: number;
    app_db_name?: string;
    sys_db_name?: string;
    ssl?: boolean;
    ssl_ca?: string;
    local_suffix?: boolean;
}

interface ConfigFile {
    name?: string;
    language?: string;
    database?: DatabaseConfig;
    database_url?: string;
    runtimeConfig?: {
        start: string[];
    };
}

export interface DbosConfig {
    uri: vscode.Uri;
    name: string;
    language?: string;
    poolConfig: PoolConfig;
    appDatabase: string;
    sysDatabase: string;
    runtime?: {
        start: string[];
    };
}

export async function loadConfigFile(configUri: vscode.Uri, token?: vscode.CancellationToken): Promise<DbosConfig | undefined> {
    const configFile = await readConfigFile(configUri, token);
    if (token?.isCancellationRequested) { return; }

    const appName = configFile.name ?? (await loadPackageJson(configUri, configFile.language)).name;
    if (token?.isCancellationRequested) { return; }
    if (!appName) {
        throw new Error(`Failed to determine app name`, { cause: configUri.fsPath });
    }

    const dbConnection = await loadDbConnection(configUri);
    if (token?.isCancellationRequested) { return; }

    const dbConfig = configFile.database_url
        ? parseDatabaseUrl(configFile.database_url)
        : configFile.database ?? {};

    const envPort = process.env.DBOS_DBPORT ? parseInt(process.env.DBOS_DBPORT, 10) : undefined;
    const envLocalSuffix = process.env.DBOS_DBLOCALSUFFIX ? process.env.DBOS_DBLOCALSUFFIX === 'true' : undefined;

    const host = process.env.DBOS_DBHOST ?? dbConfig.hostname ?? dbConnection.hostname ?? "localhost";
    const port = envPort ?? dbConfig.port ?? dbConnection.port ?? 5432;
    const user = process.env.DBOS_DBUSER ?? dbConfig.username ?? dbConnection.username ?? "postgres";
    const password = process.env.DBOS_DBPASSWORD ?? dbConfig.password ?? dbConnection.password ?? process.env.PGPASSWORD ?? "dbos";
    const localSuffix = envLocalSuffix ?? dbConfig.local_suffix ?? dbConnection.local_suffix ?? false;

    const databaseName = dbConfig.app_db_name ?? getDatabaseNameFromAppName(appName);
    const appDatabase = localSuffix ? `${databaseName}_local` : databaseName;
    const sysDatabase = configFile.database?.sys_db_name ?? `${appDatabase}_dbos_sys`;

    const ssl = await parseSSL(dbConfig.ssl, dbConfig.ssl_ca, host);

    return {
        uri: configUri,
        name: appName,
        language: configFile.language,
        runtime: configFile.runtimeConfig,
        appDatabase,
        sysDatabase,
        poolConfig: {
            host,
            port,
            user,
            password,
            connectionTimeoutMillis: dbConfig.connectionTimeoutMillis || 3000,
            ssl,
        },
    };

    async function readConfigFile(configUri: vscode.Uri, token?: vscode.CancellationToken): Promise<ConfigFile> {
        try {
            const configContent = await fs.readFile(configUri.fsPath, 'utf-8');
            if (token?.isCancellationRequested) { return {}; }
            const interpolatedContent = substituteEnvVars(configContent);
            return YAML.parse(interpolatedContent) as ConfigFile;

            function substituteEnvVars(content: string): string {
                const regex = /\${([^}]+)}/g; // Regex to match ${VAR_NAME} style placeholders
                return content.replace(regex, (_, g1: string) => {
                    return process.env[g1] || '""'; // If the env variable is not set, return an empty string.
                });
            }
        } catch (e) {
            logger.error(`Failed to load dbos-config.yaml`, {
                error: e,
                configUri: configUri.fsPath,
            });
            return {};
        }
    }

    async function loadPackageJson(configUri: vscode.Uri, language: string | undefined): Promise<{ name?: string }> {
        if (language && language !== 'node') { return {}; }

        const packageJsonPath = path.join(path.dirname(configUri.fsPath), 'package.json');
        try {
            const contents = await fs.readFile(packageJsonPath, 'utf-8');
            return JSON.parse(contents) as { name?: string };
        } catch (e) {
            logger.error(`Failed to load package.json`, {
                error: e,
                configUri: configUri.fsPath,
                packageJsonPath,
            });
            return {};
        }
    }

    function parseDatabaseUrl(dbUrl: string): DatabaseConfig {
        const connOpts = parsePGConnectionString(dbUrl);
        const url = new URL(dbUrl);
        const queryParams = Object.fromEntries(url.searchParams.entries());

        return {
            hostname: connOpts.host || undefined,
            port: connOpts.port ? parseInt(connOpts.port, 10) : undefined,
            username: connOpts.user || undefined,
            password: connOpts.password || undefined,
            app_db_name: connOpts.database || undefined,
            ssl: 'sslmode' in connOpts && (connOpts.sslmode === 'require' || connOpts.sslmode === 'verify-full'),
            ssl_ca: queryParams['sslrootcert'] || undefined,
            connectionTimeoutMillis: queryParams['connect_timeout']
                ? parseInt(queryParams['connect_timeout'], 10) * 1000
                : undefined,
        };
    }

    function getDatabaseNameFromAppName(appName: string) {
        const dbName = appName.toLowerCase().replaceAll("-", "_").replaceAll(' ', '_');
        return dbName.match(/^\d/) ? `_${dbName}` : dbName;
    }

    async function parseSSL(ssl: boolean | undefined, ssl_ca: string | undefined, host: string): Promise<PoolConfig['ssl']> {
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

async function loadDbConnection(configUri: vscode.Uri): Promise<DatabaseConnection> {
    type Nullable<T> = { [P in keyof T]-?: T[P] | null; };
    try {
        const filePath = path.join(path.dirname(configUri.fsPath), '.dbos', 'db_connection');
        const contents = await fs.readFile(filePath, 'utf8');
        const data = JSON.parse(contents) as Nullable<DatabaseConnection>;
        return {
            hostname: data.hostname ? data.hostname : undefined,
            port: data.port ? data.port : undefined,
            username: data.username ? data.username : undefined,
            password: data.password ? data.password : undefined,
            local_suffix: data.local_suffix ? data.local_suffix : undefined,
        };
    } catch (e) {
        return {};
    }
}

interface LocalCredentials {
    token: string;
    // refreshToken?: string;
    userName: string;
    organization: string;
}

export async function loadLocalCredentials(configUri: vscode.Uri): Promise<LocalCredentials | undefined> {
    try {
        const filePath = path.join(
            path.dirname(configUri.fsPath),
            '.dbos', 'credentials');
        const contents = await fs.readFile(filePath, 'utf8');
        return JSON.parse(contents) as LocalCredentials;
    } catch (e) {
        return undefined;
    }
}