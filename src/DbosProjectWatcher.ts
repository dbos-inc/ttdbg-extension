import * as vscode from 'vscode';
import * as path from 'node:path';
import { exists } from './utility';
import YAML from 'yaml';
import { logger } from './extension';

interface DbosDatabaseConfig {
    hostname: string;
    port: number;
    username: string;
    password?: string;
    connectionTimeoutMillis?: number;
    app_db_name: string;
    sys_db_name?: string;
    ssl?: boolean;
    ssl_ca?: string;
    app_db_client?: string; //"pg-node" | "prisma" | "typeorm" | "knex";
    migrate?: string[];
    rollback?: string[];
}

interface DbosConfigFile {
    version: string;
    database: DbosDatabaseConfig;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    application: any;
    env: Record<string, string>;
    runtimeConfig?: {
        entrypoints: string[];
        port: number;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dbClientMetadata?: any;
}

function substituteEnvVars(content: string): string {
    const regex = /\${([^}]+)}/g; // Regex to match ${VAR_NAME} style placeholders
    return content.replace(regex, (_, g1: string) => {
        return process.env[g1] || ""; // If the env variable is not set, return an empty string.
    });
}

type DbosProject = DbosConfigFile & {
    packageName: string;
    dirName: string;
};

async function readProject(file: vscode.Uri): Promise<DbosProject | undefined> {
    const dirName = path.dirname(file.fsPath);
    const configFile = vscode.Uri.file(path.join(dirName, "dbos-config.yaml"));
    const packageJsonFile = vscode.Uri.file(path.join(dirName, "package.json"));

    if (!await exists(configFile)) {
        logger.error(`dbos-config.yaml file not found`, { cause: configFile.fsPath });
        return undefined;
    }

    if (!await exists(packageJsonFile)) {
        logger.error(`package.json file not found`, { cause: packageJsonFile.fsPath });
        return undefined;
    }

    const configContent = await vscode.workspace.fs.readFile(configFile).then(buffer => buffer.toString());
    const interpolatedConfigContent = substituteEnvVars(configContent);
    const config = YAML.parse(interpolatedConfigContent) as DbosConfigFile;

    const packageContent = await vscode.workspace.fs.readFile(packageJsonFile).then(buffer => buffer.toString());
    const packageJson = JSON.parse(packageContent) as { name: string; };
    return { ...config, packageName: packageJson.name, dirName };
}

export class DbosProjectWatcher {
    private static readonly globPattern = "**/dbos-config.yaml";
    private readonly projectMap = new Map<string, DbosProject>();
    private readonly watcher: vscode.FileSystemWatcher;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly onProjectChangedEmitter = new vscode.EventEmitter<string>();

    get onProjectChanged() { return this.onProjectChangedEmitter.event;}

    get projects() { return Array.from(this.projectMap.values()); }

    private constructor(projects: DbosProject[]) { 
        for (const project of projects) {
            this.projectMap.set(project.dirName, project);
        }

        this.watcher = vscode.workspace.createFileSystemWatcher("**/{package.json,dbos-config.yaml}");
        this.watcher.onDidChange(this.onDidChange, this, this.disposables);
        this.watcher.onDidCreate(this.onDidChange, this, this.disposables);
        this.watcher.onDidDelete(this.onDidDelete, this, this.disposables);
    }

    dispose() {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.watcher.dispose();
    }

    private async onDidChange(uri: vscode.Uri) {
        const project = await readProject(uri);
        const dirName = project?.dirName ?? path.dirname(uri.fsPath);
        if (project) {
            this.projectMap.set(project.dirName, project);
        } else {
            this.projectMap.delete(dirName);
        }
        this.onProjectChangedEmitter.fire(dirName);
    }

    private async onDidDelete(uri: vscode.Uri) {
        const dirName = path.dirname(uri.fsPath);
        this.projectMap.delete(dirName);
        this.onProjectChangedEmitter.fire(dirName);
    }

    static async create(): Promise<DbosProjectWatcher> {
        const projects = new Array<DbosProject>();
        const configFiles = await vscode.workspace.findFiles(DbosProjectWatcher.globPattern);
        for (const configFile of configFiles) {
            const project = await readProject(configFile);
            if (project) { projects.push(project); }
        }

        return new DbosProjectWatcher(projects);
    }
}
