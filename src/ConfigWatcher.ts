import * as vscode from 'vscode';
import { ClientConfig } from 'pg';

export const CONFIG_SECTION = "dbos-ttdbg";
export const DEBUG_PROXY_URL = "debug_proxy_url";

export const PROV_DB_HOST = "prov_db_host";
export const PROV_DB_PORT = "prov_db_port";
export const PROV_DB_DATABASE = "prov_db_database";
export const PROV_DB_USER = "prov_db_user";
export const PROV_DB_PASSWORD = "prov_db_password";

export class ConfigWatcher {

    private readonly _emitter = new vscode.EventEmitter<Readonly<ClientConfig>>();
    private readonly _config: ClientConfig = {};
    private readonly _subscriptions: vscode.Disposable;

    constructor(private readonly secrets: vscode.SecretStorage) {
        const secretsSub = secrets.onDidChange(e => { this.#onConfigChange(); });
        const configSub = vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration(CONFIG_SECTION)) {
                this.#onConfigChange();
            }
        });
        this._subscriptions = vscode.Disposable.from(this._emitter, secretsSub, configSub);

        this.#onConfigChange();
    }

    dispose() {
        this._subscriptions.dispose();
    }

    get onDidChangeConfig() {
        return this._emitter.event;
    }

    get config(): Readonly<ClientConfig> {
        return this._config;
    }

    async #onConfigChange() {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

        this._config.host = cfg.get<string>(PROV_DB_HOST);
        this._config.port = cfg.get<number>(PROV_DB_PORT, 5432);
        this._config.database = cfg.get<string>(PROV_DB_DATABASE);
        this._config.user = cfg.get<string>(PROV_DB_USER);
        this._config.password = await this.secrets.get(PROV_DB_PASSWORD);

        this._emitter.fire(this._config);
    }

    async requestPassword() {
        const password = await vscode.window.showInputBox({
            prompt: "Enter provenance database password",
            password: true,
        });

        if (password) {
            await this.secrets.store(PROV_DB_PASSWORD, password);
        }

        return password;
    }

    async deletePassword() {
        await this.secrets.delete(PROV_DB_PASSWORD);
    }
}