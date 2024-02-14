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

    get provDbConfig(): ClientConfig {
        const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION);
        const port = cfg.get<number>(PROV_DB_PORT);
        return {
            host: cfg.get<string>(PROV_DB_HOST),
            port,
            database: cfg.get<string>(PROV_DB_DATABASE),
            user: cfg.get<string>(PROV_DB_USER),
            password: () => this.#getPassword(),
        };
    }

    get proxyPort(): number | undefined {
        const cfg = vscode.workspace.getConfiguration(TTDBG_CONFIG_SECTION);
        return cfg.get<number>(DEBUG_PROXY_PORT);
    }

    async #getPassword(): Promise<string> {
        let password = await this.secrets.get(PROV_DB_PASSWORD);
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

    async deletePassword() {
        await this.secrets.delete(PROV_DB_PASSWORD);
    }
}