import * as vscode from 'vscode';
import { logger, startDebuggingCodeLensCommandName } from './extension';
import { Pool, PoolClient } from 'pg';
import { DbosConfig, loadConfigFile, locateDbosConfigFile } from './dbosConfig';
import { CloudCredentialManager } from './CloudCredentialManager';
import { DbosCloudApp, getApp, getDbCredentials, getDbInstance, isUnauthorized } from './dbosCloudApi';
import path from 'node:path';
import { DebugProxyManager } from './DebugProxyManager';
import { Configuration } from './Configuration';
import { parseTypeScript } from './parsers/tsParser';
import { parsePython } from './parsers/pyParser';

interface workflow_status {
    workflow_uuid: string;
    status: string;
    name: string;
    class_name?: string;
    config_name?: string;
    authenticated_user: string;
    output: string;
    error: string;
    assumed_role: string;
    authenticated_roles: string;  // Serialized list of roles.
    request: string;  // Serialized HTTPRequest
    executor_id: string;  // Set to "local" for local deployment, set to microVM ID for cloud deployment.
    application_version: string;
    queue_name?: string;
}

type WFStatus = workflow_status & { created_at: string, updated_at: string };

async function pickWorkflow(client: PoolClient, methodName: string) {

    const result = await client.query<WFStatus>(
        "SELECT * FROM dbos.workflow_status WHERE (status = 'SUCCESS' OR status = 'ERROR') AND name = $1 ORDER BY created_at DESC",
        [methodName]);
    const items = result.rows.map(status => <vscode.QuickPickItem>{
        label: new Date(parseInt(status.created_at)).toLocaleString(),
        description: `${status.status}${status.authenticated_user.length !== 0 ? ` (${status.authenticated_user})` : ""}`,
        detail: status.workflow_uuid,
    });

    const editButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon("edit"),
        tooltip: "Specify workflow id directly"
    };

    const disposables: { dispose(): any; }[] = [];
    try {
        const result = await new Promise<vscode.QuickInputButton | vscode.QuickPickItem | undefined>(resolve => {
            const input = vscode.window.createQuickPick();
            input.title = "Select a workflow ID to debug";
            input.canSelectMany = false;
            input.items = items;
            input.buttons = [editButton];
            let selectedItem: vscode.QuickPickItem | undefined = undefined;
            disposables.push(
                input.onDidAccept(() => {
                    logger.debug("showWorkflowPick.onDidAccept", { selectedItem });
                    resolve(selectedItem);
                    input.dispose();
                }),
                input.onDidHide(() => {
                    logger.debug("showWorkflowPick.onDidHide", { selectedItem });
                    resolve(undefined);
                    input.dispose();
                }),
                input.onDidChangeSelection(items => {
                    logger.debug("showWorkflowPick.onDidChangeSelection", { items });
                    selectedItem = items.length === 0 ? undefined : items[0];
                }),
                input.onDidTriggerButton(button => {
                    logger.debug("showWorkflowPick.onDidTriggerButton", { button });
                    resolve(button);
                    input.dispose();
                })
            );
            input.show();
        });
        if (result === undefined) { return undefined; }
        if ("label" in result) {
            return result.detail;
        }
        if (result === editButton) {
            return await vscode.window.showInputBox({ prompt: "Enter the workflow ID" });
        } else {
            throw new Error(`Unexpected button: ${result.tooltip ?? "<unknown>"}`);
        }
    } finally {
        disposables.forEach(d => d.dispose());
    }
}

class DbosCodeLens extends vscode.CodeLens {
    constructor(
        range: vscode.Range,
        public readonly uri: vscode.Uri,
        public readonly name: string,
        public readonly kind: "local" | "cloud" | "time-travel",
    ) {
        super(range);
    }
}

interface DbConnectionInfo {
    host: string;
    port: number;
    user: string;
    password: string;
    provDatabase?: string;
}

type AppInfo = DbosCloudApp & { timeTravel?: boolean };

const nodeExecutables: ReadonlyArray<string> = ['node', 'npm', 'npx'];

export class CodeLensProvider implements vscode.CodeLensProvider<DbosCodeLens>, vscode.Disposable {
    private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    private readonly credChangeSub: vscode.Disposable;
    private readonly connectionMap = new Map<string, Pool>();
    private readonly configMap = new Map<string, DbosConfig>();
    private readonly appMap = new Map<string, DbosCloudApp>();
    private readonly dbInfoMap = new Map<string, DbConnectionInfo>();

    readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

    constructor(
        private readonly credManager: CloudCredentialManager,
        private readonly debugProxyManager: DebugProxyManager,
    ) {
        this.credChangeSub = credManager.onCredentialChange(
            () => {
                this.appMap.clear();
                this.dbInfoMap.clear();
                this.onDidChangeCodeLensesEmitter.fire();
            });
    }

    dispose() {
        this.credChangeSub.dispose();
        this.onDidChangeCodeLensesEmitter.dispose();

        const connections = [...this.connectionMap.values()];
        this.connectionMap.clear();
        for (const pool of connections) {
            pool.end().catch(e => logger.error("dispose", e));
        }
    }

    async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<DbosCodeLens[] | undefined> {
        logger.debug("provideCodeLenses", { uri: document.uri.toString() });
        try {
            const parser = getParser(document.languageId);
            if (!parser) { return; }
            const cred = await this.credManager.getValidCredential(undefined);
            const lenses = new Array<DbosCodeLens>();
            for (const { start, end, name } of parser(document, token)) {
                if (token.isCancellationRequested) { break; }
                const range = new vscode.Range(start, end);
                lenses.push(new DbosCodeLens(range, document.uri, name, "local"));
                if (cred) {
                    lenses.push(
                        new DbosCodeLens(range, document.uri, name, "cloud"),
                        new DbosCodeLens(range, document.uri, name, "time-travel"),
                    );
                }
            }
            return lenses;
        } catch (e) {
            logger.error("provideCodeLenses", e);
        }
        return undefined;

        function getParser(languageId: string) {
            switch (languageId) {
                case 'typescript': return parseTypeScript;
                case 'python': return parsePython;
                default: return undefined;
            }
        }
    }

    async resolveCodeLens(codeLens: DbosCodeLens, token: vscode.CancellationToken): Promise<DbosCodeLens> {
        logger.debug("resolveCodeLens", { name: codeLens.name, uri: codeLens.uri.toString(), kind: codeLens.kind });

        const config = await this.#getConfig(codeLens.uri, token);
        if (config) {
            const name = codeLens.name;
            if (codeLens.kind === "local") {
                codeLens.command = {
                    title: '♻️ Replay Debug',
                    tooltip: `Debug ${name} with the replay debugger`,
                    command: startDebuggingCodeLensCommandName,
                    arguments: [name, config]
                };
            }
            if (codeLens.kind === "cloud") {
                const app = await this.#getCloudApp(config, token);
                if (app) {
                    codeLens.command = {
                        title: '☁️ Cloud Replay Debug',
                        tooltip: `Debug ${name} with the cloud replay debugger`,
                        command: startDebuggingCodeLensCommandName,
                        arguments: [name, config, app]
                    };
                }
            }
            if (codeLens.kind === "time-travel") {
                const app = await this.#getCloudApp(config, token);
                if (app?.ProvenanceDatabaseName) {
                    codeLens.command = {
                        title: '⏳ Time-Travel Debug',
                        tooltip: `Debug ${name} with the time travel debugger`,
                        command: startDebuggingCodeLensCommandName,
                        arguments: [name, config, { ...app, timeTravel: true }]
                    };
                }
            }
        }
        return codeLens;
    }

    getCodeLensDebugCommand() {
        const $this = this;
        return async function (
            methodName?: string,
            config?: DbosConfig,
            app?: AppInfo,
        ) {
            const db = app ? await $this.#getDbConnectionInfo(app) : undefined;
            logger.info("codeLensDebug", {
                methodName: methodName ?? null,
                config: config?.toString() ?? null,
                app: app ?? null,
                db: db ?? null
            });
            if (!methodName || !config) { return; }

            const workflowID = await $this.#pickWorkflow(methodName, config, db);
            logger.info("codeLensDebug", { workflowID: workflowID ?? null });
            if (!workflowID) { return; }

            const debugConfig = $this.#getDebugConfig(config, workflowID, db, app?.timeTravel);
            logger.info("startDebuggingFromCodeLens", { debugConfig: debugConfig ?? null });

            if (app?.timeTravel) {
                if (!app.ProvenanceDatabaseName) { throw new Error("ProvenanceDatabaseName not set "); }
                if (!db) { throw new Error("DB Instance Info not set"); }

                const proxyPort = Configuration.getProxyPort();
                debugConfig.env["DBOS_DBPORT"] = proxyPort.toString();

                $this.debugProxyManager.launchDebugProxy({
                    host: db.host,
                    port: db.port,
                    user: db.user,
                    password: db.password,
                    database: app.ProvenanceDatabaseName,
                    proxyPort
                });

            }

            const folder = vscode.workspace.getWorkspaceFolder(config.uri);
            const debuggerStarted = await vscode.debug.startDebugging(folder, debugConfig);
            if (!debuggerStarted) {
                throw new Error("launchDebugger: Debugger failed to start", {
                    cause: {
                        configUri: config.uri.toString(),
                        workflowID,
                        debugConfig,
                        folder,
                    }
                });
            }
        };
    }

    #getDebugConfig(config: DbosConfig, workflowID: string, db?: DbConnectionInfo, timeTravel?: boolean): vscode.DebugConfiguration {
        if (config.language && config.language !== "node") {
            throw new Error(`Unsupported language: ${config.language ?? null}`);
        }

        timeTravel = timeTravel ?? false;
        const debugConfig: vscode.DebugConfiguration = {
            type: 'node',
            request: 'launch',
            name: 'Replay Debug',
            cwd: path.dirname(config.uri.fsPath),
            env: {
                DBOS_DEBUG_WORKFLOW_ID: workflowID,
                DBOS_DBHOST: timeTravel ? "localhost" : db?.host,
                DBOS_DBPORT: timeTravel ? undefined : db?.port.toString(),
                DBOS_DBUSER: timeTravel ? undefined : db?.user,
                DBOS_DBPASSWORD: timeTravel ? undefined : db?.password,
                DBOS_DBLOCALSUFFIX: timeTravel ? undefined : (db ? "false" : undefined),
            }
        };

        const start = config.runtime?.start ?? [];
        if (start.length === 0) {
            debugConfig.runtimeExecutable = "npx";
            debugConfig.args = ['dbos', 'debug', '--uuid', workflowID];
        } else if (start.length === 1) {
            const args = start[0].split(" ");
            if (!nodeExecutables.includes(args[0])) {
                throw new Error("Unsupported runtimeExecutable: " + args[0]);
            }
            debugConfig.runtimeExecutable = args[0];
            debugConfig.args = args.slice(1);
        }
        else {
            throw new Error("multiple runtimeConfig.start commands not implemented");
        }

        return debugConfig;
    }

    async #pickWorkflow(methodName: string, config: DbosConfig, db: DbConnectionInfo | undefined) {
        const client = await this.#getDbClient(config, db);
        try {
            return await pickWorkflow(client, methodName);
        } finally {
            client.release();
        }
    }

    async #getCloudApp(config: DbosConfig, token?: vscode.CancellationToken): Promise<DbosCloudApp | undefined> {
        const cred = await this.credManager.getValidCredential(undefined);
        if (!cred || token?.isCancellationRequested) { return; }
        const key = `${config.name}:${cred.domain}:${cred.userName}`;
        let app = this.appMap.get(key);
        if (!app) {
            try {
                const $app = await getApp(config.name, cred, token);
                if (!isUnauthorized($app)) {
                    app = $app;
                    this.appMap.set(key, app);
                }
            } catch (error) {
                logger.debug("#getCloudApp", error);
            }
        }
        return app;
    }

    async #getDbConnectionInfo(app: AppInfo, token?: vscode.CancellationToken): Promise<DbConnectionInfo | undefined> {
        const cred = await this.credManager.getValidCredential(undefined);
        if (!cred || token?.isCancellationRequested) { return; }

        const key = `${app.Name}:${cred.domain}:${cred.userName}` + (app.timeTravel ? ":prov" : "");
        let dbInfo = this.dbInfoMap.get(key);
        if (!dbInfo) {
            try {
                const [dbi, dbCred] = await Promise.all([
                    getDbInstance(app.PostgresInstanceName, cred, token),
                    getDbCredentials(app.PostgresInstanceName, cred, token)
                ]);
                if (!isUnauthorized(dbi) && !isUnauthorized(dbCred)) {
                    dbInfo = {
                        host: dbi.HostName,
                        port: dbi.Port,
                        user: dbi.DatabaseUsername,
                        password: dbCred.Password,
                        provDatabase: app.timeTravel ? app.ProvenanceDatabaseName : undefined,
                    };
                    this.dbInfoMap.set(key, dbInfo);
                }
            } catch (error) {
                logger.debug("#getCloudDatabase", error);
            }
        }
        return dbInfo;
    }

    async #getConfig(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<DbosConfig | undefined> {
        const configUri = await locateDbosConfigFile(uri);
        if (!configUri) { return; }
        const key = configUri.toString();
        let config = this.configMap.get(key);
        if (!config) {
            config = await loadConfigFile(configUri, token);
            logger.debug("ConnectionMap.getConfig", {
                configUri: configUri.toString(),
                config: config ?? null
            });
            if (config) {
                this.configMap.set(key, config);
            }
        }
        return config;
    }

    async #getDbClient(config: DbosConfig, db: DbConnectionInfo | undefined): Promise<PoolClient> {
        const database = db?.provDatabase ?? config.sysDatabase;
        const key = db
            ? `${db?.host}:${db?.port}:${db?.user}:${database}`
            : `${config.poolConfig.host}:${config.poolConfig.port}:${config.poolConfig.user}:${database}`;
        let pool = this.connectionMap.get(key);
        if (!pool) {
            if (db) {
                pool = new Pool({
                    host: db.host,
                    port: db.port,
                    user: db.user,
                    password: db.password,
                    database,
                    ssl: { rejectUnauthorized: false }
                });
            } else {
                pool = new Pool({ ...config.poolConfig, database });
            }
            this.connectionMap.set(key, pool);
        }
        try {
            return await pool.connect();
        } catch (error) {
            const message = db 
                ? "Failed to connect to DBOS Cloud database"
                : `Failed to connect to database ${config.poolConfig.host}:${config.poolConfig.port}/${database}`;
            logger.error("#getDbClient", { message, error });
            throw new Error(message, { cause: error });
        }
    }
}

export interface DbosWorkflowMethod {
    name: string;
    start: vscode.Position;
    end: vscode.Position;
}

