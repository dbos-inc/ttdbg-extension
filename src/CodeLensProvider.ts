import * as vscode from 'vscode';
import { logger, startDebuggingCodeLensCommandName } from './extension';
import { ClientBase, Pool, PoolClient, PoolConfig } from 'pg';
import { DbosConfig, loadConfigFile, locateDbosConfigFile } from './dbosConfig';
import { CloudCredentialManager } from './CloudCredentialManager';
import { getApp, getDbCredentials, getDbInstance, getDbProxyRole, isUnauthorized } from './dbosCloudApi';
import { DebugProxyManager } from './DebugProxyManager';
import { Configuration } from './Configuration';
import { parseTypeScript } from './parsers/tsParser';
import { parsePython } from './parsers/pyParser';
import path from 'path';
import type { workflow_status } from './dbosTables';

export interface DbosWorkflowMethod {
    name: string;
    start: vscode.Position;
    end: vscode.Position;
}

interface CloudConnection {
    user: string;
    database: string;
    password: string;
    port: number;
    host: string;
    timeTravel: boolean;
}

export interface CloudConnections {
    cloudRelay?: CloudConnection;
    timeTravel?: CloudConnection;
}

const nodeExecutables: ReadonlyArray<string> = ['node', 'npm', 'npx'];

export class CodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    private readonly fileSystemWatcher = vscode.workspace.createFileSystemWatcher("**/dbos-config.yaml");
    private readonly subscriptions = new Array<vscode.Disposable>();
    private readonly connectionMap = new Map<string, Pool>();

    readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

    constructor(
        private readonly extensionId: string,
        private readonly credManager: CloudCredentialManager,
        private readonly debugProxyManager: DebugProxyManager,
    ) {
        this.subscriptions.push(
            credManager.onCredentialChange(() => this.#credentialChange()),
            this.fileSystemWatcher.onDidCreate((uri) => this.#configChanged(uri)),
            this.fileSystemWatcher.onDidChange((uri) => this.#configChanged(uri)),
            this.fileSystemWatcher.onDidDelete((uri) => this.#configChanged(uri)),
        );
    }

    #credentialChange() {
        this.onDidChangeCodeLensesEmitter.fire();
    }

    #configChanged(_uri: vscode.Uri) {
        this.onDidChangeCodeLensesEmitter.fire();
    }

    dispose() {
        this.subscriptions.forEach(d => d.dispose());
        this.onDidChangeCodeLensesEmitter.dispose();

        const connections = [...this.connectionMap.values()];
        this.connectionMap.clear();
        for (const pool of connections) {
            pool.end().catch(e => logger.error("dispose", e));
        }
    }

    async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        logger.debug("provideCodeLenses", { uri: document.uri.toString() });
        try {
            const parser = getParser(document.languageId);
            if (!parser) { return []; }

            const configUri = await locateDbosConfigFile(document.uri);
            const config = configUri ? await loadConfigFile(configUri, token) : undefined;
            if (!config) { return []; }

            const { cloudRelay, timeTravel } = await this.#getCloudConnections(config, token);

            const lenses = new Array<vscode.CodeLens>();
            for (const { start, end, name } of parser(document, token)) {
                if (token.isCancellationRequested) { break; }
                const range = new vscode.Range(start, end);
                lenses.push(new vscode.CodeLens(range, {
                    title: '🔁 Replay Debug',
                    tooltip: `Debug ${name} with the replay debugger`,
                    command: startDebuggingCodeLensCommandName,
                    arguments: [name, config]
                }));

                if (cloudRelay) {
                    lenses.push(new vscode.CodeLens(range, {
                        title: '☁️ Cloud Replay Debug',
                        tooltip: `Debug ${name} with the cloud replay debugger`,
                        command: startDebuggingCodeLensCommandName,
                        arguments: [name, config, cloudRelay]
                    }));
                }

                if (timeTravel && document.languageId === 'typescript' && Configuration.getTimeTravelCodeLensEnabled()) {
                    lenses.push(new vscode.CodeLens(range, {
                        title: '⏳ Time-Travel Debug',
                        tooltip: `Debug ${name} with the time travel debugger`,
                        command: startDebuggingCodeLensCommandName,
                        arguments: [name, config, timeTravel]
                    }));
                }
            }
            return lenses;
        } catch (e) {
            logger.error("provideCodeLenses", e);
        }
        return [];

        function getParser(languageId: string) {
            switch (languageId) {
                case 'typescript': return parseTypeScript;
                case 'python': return parsePython;
                default: return undefined;
            }
        }
    }

    async #getCloudConnections(config: DbosConfig, token?: vscode.CancellationToken): Promise<CloudConnections> {
        try {
            const cred = await this.credManager.getValidCredential(undefined);
            if (!cred || token?.isCancellationRequested) { return {}; }

            const app = await getApp(config.name, cred, token);
            if (isUnauthorized(app)) { return {}; }

            const [dbi, dbCred, proxyCred] = await Promise.all([
                getDbInstance(app.PostgresInstanceName, cred, token),
                getDbCredentials(app.PostgresInstanceName, cred, token),
                app.ProvenanceDatabase ? getDbProxyRole(app.PostgresInstanceName, cred, token) : Promise.resolve(undefined)
            ]);

            const cloudRelay: CloudConnection | undefined = !isUnauthorized(dbi) && !isUnauthorized(dbCred)
                ? {
                    host: dbi.HostName,
                    port: dbi.Port,
                    database: `${app.ApplicationDatabaseName}_dbos_sys`,
                    user: dbCred.RoleName,
                    password: dbCred.Password,
                    timeTravel: false,
                }
                : undefined;

            let timeTravel: CloudConnection | undefined = app.ProvenanceDatabase && proxyCred && !isUnauthorized(proxyCred)
                ? {
                    host: app.ProvenanceDatabase.HostName,
                    port: app.ProvenanceDatabase.Port,
                    database: app.ProvenanceDatabase.Name,
                    user: proxyCred.RoleName,
                    password: proxyCred.Secret,
                    timeTravel: true,
                }
                : undefined;

            return { cloudRelay, timeTravel };
        } catch (e) {
            logger.error("#getCloudLensInfo", e);
            return {};
        }
    }

    getGetCloudConnectionsCommand() {
        const $this = this;
        return async function (config?: DbosConfig): Promise<CloudConnections> {
            logger.info("getCloudConnections", { config: config ?? null });
            if (!config) { return {}; }
            return await $this.#getCloudConnections(config);
        };
    }

    getCodeLensDebugCommand() {
        const $this = this;
        return async function (
            methodName?: string,
            config?: DbosConfig,
            cloudLensInfo?: CloudConnection
        ) {
            logger.info("codeLensDebug", {
                methodName: methodName ?? null,
                config: config ?? null,
                cloudLensInfo: cloudLensInfo ?? null,
            });
            if (!methodName || !config) { return; }

            const workflowID = await $this.#pickWorkflow(methodName, config, cloudLensInfo);
            logger.info("codeLensDebug", { workflowID: workflowID ?? null });
            if (!workflowID) { return; }

            await $this.#launchDebugger(workflowID, config, cloudLensInfo);
        };
    }

    async #launchDebugger(workflowID: string, config: DbosConfig, cloudLensInfo: CloudConnection | undefined) {
        const debugConfig = getDebugConfig(workflowID, config, cloudLensInfo);
        logger.info("startDebuggingFromCodeLens", { debugConfig: debugConfig ?? null });
        if (!debugConfig) { return; }

        if (cloudLensInfo?.timeTravel === true) {
            this.debugProxyManager.launchDebugProxy({
                host: cloudLensInfo.host,
                port: cloudLensInfo.port,
                user: cloudLensInfo.user,
                password: cloudLensInfo.password,
                database: cloudLensInfo.database,
                proxyPort: Configuration.getProxyPort()
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

        function getDebugConfig(workflowID: string, config: DbosConfig, cloudLensInfo: CloudConnection | undefined): vscode.DebugConfiguration | undefined {
            const language = config.language ?? "node";
            switch (language) {
                case "node": return getNodeDebugConfig(workflowID, config, cloudLensInfo);
                case "python": return getPythonDebugConfig(workflowID, config, cloudLensInfo);
                default: throw new Error(`Unsupported language: ${language}`);
            }
        }

        function getPythonDebugConfig(workflowID: string, config: DbosConfig, cloudLensInfo: CloudConnection | undefined): vscode.DebugConfiguration | undefined {
            if (config.language !== "python") {
                throw new Error(`Expected python language, received ${config.language ?? null}`);
            }

            const ext = vscode.extensions.getExtension("ms-python.debugpy");
            if (!ext) {
                vscode.window.showErrorMessage("Python debugger not found. Please install the Python extension for VSCode.", "Install", "Cancel")
                    .then(value => {
                        if (value === "Install") {
                            vscode.env.openExternal(vscode.Uri.parse("https://marketplace.visualstudio.com/items?itemName=ms-python.python"));
                        }
                    });
                return undefined;
            }

            const timeTravel = cloudLensInfo?.timeTravel ?? false;
            if (timeTravel) {
                vscode.window.showErrorMessage("Python does not support time travel debugging at this time");
                return undefined;
            }
            return {
                type: 'debugpy',
                request: 'launch',
                name: cloudLensInfo?.timeTravel ? "Time-Travel Debug" : "Replay Debug",
                module: 'dbos',
                args: ['debug', workflowID],
                cwd: path.dirname(config.uri.fsPath),
                justMyCode: Configuration.getJustMyCode(),
                env: {
                    DBOS_DEBUG_TIME_TRAVEL: timeTravel ? "true" : undefined,
                    DBOS_DBHOST: timeTravel ? "localhost" : cloudLensInfo?.host,
                    DBOS_DBPORT: timeTravel ? undefined : cloudLensInfo?.port.toString(),
                    DBOS_DBUSER: timeTravel ? undefined : cloudLensInfo?.user,
                    DBOS_DBPASSWORD: timeTravel ? undefined : cloudLensInfo?.password,
                    DBOS_DBLOCALSUFFIX: (timeTravel || cloudLensInfo) ? "false" : undefined,
                }
            };
        }

        function getNodeDebugConfig(workflowID: string, config: DbosConfig, cloudLensInfo: CloudConnection | undefined): vscode.DebugConfiguration {
            if ((config.language ?? "node") !== "node") {
                throw new Error(`Expected node language, received ${config.language ?? null}`);
            }

            const timeTravel = cloudLensInfo?.timeTravel ?? false;
            const debugConfig: vscode.DebugConfiguration = {
                type: 'node',
                request: 'launch',
                name: timeTravel ? "Time-Travel Debug" : "Replay Debug",
                cwd: path.dirname(config.uri.fsPath),
                env: getDebugConfigEnv(cloudLensInfo),
                skipFiles: Configuration.getJustMyCode()
                    ? ["<node_internals>/**/*.js", path.join(path.dirname(config.uri.fsPath), "node_modules", "**", "*.js")]
                    : undefined,
            };

            const start = config.runtime?.start ?? [];
            if (start.length === 0) {
                debugConfig.runtimeExecutable = "npx";
                debugConfig.args = ['dbos', 'debug', '--uuid', workflowID];
                if (timeTravel) {
                    debugConfig.args.push('--time-travel');
                }
            } else if (start.length === 1) {
                const args = start[0].split(" ");
                if (!nodeExecutables.includes(args[0])) {
                    throw new Error("Unsupported runtimeExecutable: " + args[0]);
                }
                debugConfig.runtimeExecutable = args[0];
                debugConfig.args = args.slice(1);
                debugConfig.env.DBOS_DEBUG_WORKFLOW_ID = workflowID;
                if (timeTravel) {
                    debugConfig.env.DBOS_DEBUG_TIME_TRAVEL = "true";
                }
            }
            else {
                throw new Error("multiple runtimeConfig.start command support not implemented");
            }

            return debugConfig;
        }

        function getDebugConfigEnv(cloudLensInfo: CloudConnection | undefined): Record<string, string> {
            const timeTravel = cloudLensInfo?.timeTravel ?? false;
            if (timeTravel) {
                return {
                    DBOS_DBHOST: "localhost",
                    DBOS_DBPORT: `${Configuration.getProxyPort()}`,
                    DBOS_DBLOCALSUFFIX: "false",
                };
            } else if (cloudLensInfo) {
                return {
                    DBOS_DBHOST: cloudLensInfo.host,
                    DBOS_DBPORT: `${cloudLensInfo.port}`,
                    DBOS_DBUSER: cloudLensInfo.user,
                    DBOS_DBPASSWORD: cloudLensInfo.password,
                    DBOS_DBLOCALSUFFIX: "false"
                };
            }
            return {};
        }
    }

    getLaunchDebuggerCommand() {
        const $this = this;
        return async function (workflowID: string, config: DbosConfig, cloudLensInfo: CloudConnection | undefined) {
            await $this.#launchDebugger(workflowID, config, cloudLensInfo);
        };
    }

    async #pickWorkflow(methodName: string, config: DbosConfig, cloudLensInfo: CloudConnection | undefined) {
        const client = await this.#getDbClient(config, cloudLensInfo);
        if (!client) { return undefined; }
        try {
            return await showWorkflowPicker(client, methodName, this.extensionId);
        } finally {
            client.release();
        }

        async function showWorkflowPicker(client: ClientBase, methodName: string, extensionId: string) {
            const result = await client.query<workflow_status>(
                "SELECT * FROM dbos.workflow_status WHERE (status = 'SUCCESS' OR status = 'ERROR') AND name = $1 ORDER BY created_at DESC",
                [methodName]);

            if (result.rowCount === 0) {
                vscode.window.showErrorMessage(`No workflows found for method ${methodName}`);
                return undefined;
            }

            const items = result.rows.map(status => {
                const createdAt = new Date(Number(status.created_at)).toLocaleString();
                return <vscode.QuickPickItem>{
                    label: status.workflow_uuid,
                    description: `${status.status}`,
                    detail: status.authenticated_user && status.authenticated_user.length !== 0
                        ? `at ${createdAt} by ${status.authenticated_user}`
                        : `at ${createdAt}`
                };
            });

            const editButton: vscode.QuickInputButton = {
                iconPath: new vscode.ThemeIcon("edit"),
                tooltip: "Specify workflow id directly"
            };

            const consoleButton: vscode.QuickInputButton = {
                iconPath: new vscode.ThemeIcon("server"),
                tooltip: "Select workflow via DBOS Cloud Conole"
            };

            const disposables: { dispose(): any; }[] = [];
            try {
                const result = await new Promise<vscode.QuickInputButton | vscode.QuickPickItem | undefined>(resolve => {
                    const input = vscode.window.createQuickPick();
                    input.title = "Select a workflow ID to debug";
                    input.canSelectMany = false;
                    input.items = items;
                    input.buttons = cloudLensInfo ? [editButton, consoleButton] : [editButton];
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
                    return result.label;
                }
                if (result === editButton) {
                    return await vscode.window.showInputBox({ prompt: "Enter the workflow ID" });
                }
                if (result === consoleButton) {
                    if (!cloudLensInfo) { return undefined; }
                    const path = cloudLensInfo.timeTravel ? "tt-debug" : "debug";
                    const debugUri = vscode.Uri.parse(`${vscode.env.uriScheme}://${extensionId}/${path}?app_name=${config.name}`);
                    const callbackUri = await vscode.env.asExternalUri(debugUri);

                    const navigateUri = vscode.Uri.parse(`https://console.dbos.dev/applications/${config.name}/workflows?workflow_name=${methodName}&callback_uri=${encodeURI(callbackUri.toString())}`);
                    vscode.env.openExternal(navigateUri)
                        .then(undefined, error => logger.error("openExternal", { error, navigateUri: navigateUri.toString() }));

                    return undefined;
                }

                throw new Error(`Unexpected button: ${result.tooltip ?? "<unknown>"}`);
            } finally {
                disposables.forEach(d => d.dispose());
            }
        }
    }

    async #getDbClient({ poolConfig, sysDatabase }: DbosConfig, cloudLensInfo: CloudConnection | undefined): Promise<PoolClient | undefined> {
        const key = cloudLensInfo
            ? `${cloudLensInfo.host}:${cloudLensInfo.port}:${cloudLensInfo.user}:${cloudLensInfo.database}`
            : `${poolConfig.host}:${poolConfig.port}:${poolConfig.user}:${sysDatabase}`;
        let pool = this.connectionMap.get(key);
        if (!pool) {
            const dbConfig: PoolConfig = cloudLensInfo
                ? {
                    host: cloudLensInfo.host,
                    port: cloudLensInfo.port,
                    user: cloudLensInfo.user,
                    password: cloudLensInfo.password,
                    database: cloudLensInfo.database,
                    ssl: { rejectUnauthorized: false }
                }
                : { ...poolConfig, database: sysDatabase };
            pool = new Pool(dbConfig);
            this.connectionMap.set(key, pool);
        }
        try {
            return await pool.connect();
        } catch (error) {
            const message = `Failed to connect to database ${poolConfig.host}:${poolConfig.port}/${sysDatabase}. Error message: ${(error as any).toString()}`;
            logger.error("#getDbClient", { message, error });
            vscode.window.showErrorMessage(message);
            return undefined;
        }
    }
}
