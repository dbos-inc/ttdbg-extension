import * as vscode from 'vscode';
import { logger, startDebuggingCodeLensCommandName } from './extension';
import { ClientBase, Pool, PoolClient, PoolConfig } from 'pg';
import { DbosConfig, loadConfigFile, locateDbosConfigFile } from './dbosConfig';
import { CloudCredentialManager } from './CloudCredentialManager';
import { DbosCloudApp, DbosCloudDbCredentials, DbosCloudDbInstance, DbosCloudDbProxyRole, getApp, getDbCredentials, getDbInstance, getDbProxyRole, isUnauthorized } from './dbosCloudApi';
import { DebugProxyManager } from './DebugProxyManager';
import { Configuration } from './Configuration';
import { parseTypeScript } from './parsers/tsParser';
import { parsePython } from './parsers/pyParser';
import path from 'path';

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

export interface DbosWorkflowMethod {
    name: string;
    start: vscode.Position;
    end: vscode.Position;
}

interface CloudLensInfo {
    user: string;
    database: string;
    password: string;
    port: number;
    host: string;
    timeTravel: boolean;
}

async function pickWorkflow(client: ClientBase, methodName: string) {

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

const nodeExecutables: ReadonlyArray<string> = ['node', 'npm', 'npx'];

export class CodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    private readonly fileSystemWatcher = vscode.workspace.createFileSystemWatcher("**/dbos-config.yaml");
    private readonly subscriptions = new Array<vscode.Disposable>();
    private readonly connectionMap = new Map<string, Pool>();

    readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

    constructor(
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

            const config = await this.#getConfig(document.uri, token);
            if (!config) { return []; }

            const { cloudRelay, timeTravel } = await this.#getCloudLensInfo(config, token);

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

                if (timeTravel) {
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

    async #getConfig(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<DbosConfig | undefined> {
        const configUri = await locateDbosConfigFile(uri);
        return configUri ? await loadConfigFile(configUri, token) : undefined;
    }

    async #getCloudLensInfo(config: DbosConfig, token?: vscode.CancellationToken): Promise<{ cloudRelay?: CloudLensInfo; timeTravel?: CloudLensInfo; }> {
        const cred = await this.credManager.getValidCredential(undefined);
        if (!cred || token?.isCancellationRequested) { return {}; }

        const app = await getApp(config.name, cred, token);
        if (isUnauthorized(app)) { return {}; }

        const [dbi, dbCred, proxyCred] = await Promise.all([
            getDbInstance(app.PostgresInstanceName, cred, token),
            getDbCredentials(app.PostgresInstanceName, cred, token),
            app.ProvenanceDatabase ? getDbProxyRole(app.PostgresInstanceName, cred, token) : Promise.resolve(undefined)
        ]);

        const cloudRelay: CloudLensInfo | undefined = !isUnauthorized(dbi) && !isUnauthorized(dbCred)
            ? {
                host: dbi.HostName,
                port: dbi.Port,
                database: `${app.ApplicationDatabaseName}_dbos_sys`,
                user: dbCred.RoleName,
                password: dbCred.Password,
                timeTravel: false,
            } 
            : undefined;

        let timeTravel: CloudLensInfo | undefined = app.ProvenanceDatabase && proxyCred && !isUnauthorized(proxyCred)
            ? {
                host: app.ProvenanceDatabase.HostName,
                port: app.ProvenanceDatabase.Port,
                database: app.ProvenanceDatabase.Name,
                user: proxyCred.RoleName,
                password: proxyCred.Secret,
                timeTravel: true,
            }
            : undefined;

        return { cloudRelay, timeTravel }
    }

    getCodeLensDebugCommand() {
        const $this = this;
        return async function (
            methodName?: string,
            config?: DbosConfig,
            cloudLensInfo?: CloudLensInfo
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


            const debugConfig = $this.#getDebugConfig(workflowID, config, cloudLensInfo);
            logger.info("startDebuggingFromCodeLens", { debugConfig: debugConfig ?? null });

            if (cloudLensInfo && (cloudLensInfo.timeTravel ?? false)) {
                const proxyPort = Configuration.getProxyPort();
                debugConfig.env["DBOS_DBPORT"] = proxyPort.toString();

                $this.debugProxyManager.launchDebugProxy({
                    host: cloudLensInfo.host,
                    port: cloudLensInfo.port,
                    user: cloudLensInfo.user,
                    password: cloudLensInfo.password,
                    database: cloudLensInfo.database,
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

    #getDebugConfig(workflowID: string, config: DbosConfig, cloudLensInfo: CloudLensInfo | undefined): vscode.DebugConfiguration {
        if (config.language && config.language !== "node") {
            throw new Error(`Unsupported language: ${config.language ?? null}`);
        }

        const timeTravel = cloudLensInfo?.timeTravel ?? false;
        const debugConfig: vscode.DebugConfiguration = {
            type: 'node',
            request: 'launch',
            name: cloudLensInfo?.timeTravel ? "Time-Travel Debug" : "Replay Debug",
            cwd: path.dirname(config.uri.fsPath),
            env: {
                DBOS_DEBUG_WORKFLOW_ID: workflowID,
                DBOS_DBHOST: timeTravel ? "localhost" : cloudLensInfo?.host,
                DBOS_DBPORT: timeTravel ? undefined : cloudLensInfo?.port.toString(),
                DBOS_DBUSER: timeTravel ? undefined : cloudLensInfo?.user,
                DBOS_DBPASSWORD: timeTravel ? undefined : cloudLensInfo?.password,
                DBOS_DBLOCALSUFFIX: timeTravel ? undefined : (cloudLensInfo ? "false" : undefined),
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

    async #pickWorkflow(methodName: string, config: DbosConfig, cloudLensInfo: CloudLensInfo | undefined) {
        const client = await this.#getDbClient(config, cloudLensInfo);
        try {
            return await pickWorkflow(client, methodName);
        } finally {
            client.release();
        }
    }

    async #getDbClient({ poolConfig, sysDatabase }: DbosConfig, cloudLensInfo: CloudLensInfo | undefined): Promise<PoolClient> {
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
            const message = `Failed to connect to database ${poolConfig.host}:${poolConfig.port}/${sysDatabase}`;
            logger.error("#getDbClient", { message, error });
            throw new Error(message, { cause: error });
        }
    }
}
