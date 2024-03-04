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
