import * as vscode from 'vscode';
import { ClientConfig } from 'pg';

const TTDBG_CONFIG_SECTION = "dbos-ttdbg";
const PROV_DB_HOST = "prov_db_host";
const PROV_DB_PORT = "prov_db_port";
const PROV_DB_DATABASE = "prov_db_database";
const PROV_DB_USER = "prov_db_user";
const PROV_DB_PASSWORD = `${TTDBG_CONFIG_SECTION}.prov_db_password`;
const DEBUG_PROXY_PORT = "debug_proxy_port";

export class Configuration {
    constructor(private readonly secrets: vscode.SecretStorage) { }

    async getProvDbConfig(folder: vscode.WorkspaceFolder): Promise<ClientConfig> {
        const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION, folder);
        const host = cfg.get<string>(PROV_DB_HOST);
        const port = cfg.get<number>(PROV_DB_PORT);
        const database = cfg.get<string>(PROV_DB_DATABASE);
        const user = cfg.get<string>(PROV_DB_USER); 

        return {
            host,
            port,
            database,
            user,
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
        return `${PROV_DB_PASSWORD}.${folder.uri.fsPath}`;
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
            await this.secrets.store(PROV_DB_PASSWORD, password);
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