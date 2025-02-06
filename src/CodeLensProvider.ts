import * as vscode from 'vscode';
import ts from 'typescript';
import { logger, startDebuggingCodeLensCommandName } from './extension';
import { Pool, PoolClient } from 'pg';
import { DbosConfig, loadConfigFile, locateDbosConfigFile } from './dbosConfig';
import path from 'path';
import { CloudCredentialManager } from './CloudCredentialManager';
import { getApp, getDbCredentials, getDbInstance, isUnauthorized } from './dbosCloudApi';

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

class ConnectionMap {
    readonly #connectionMap = new Map<string, Pool>();
    readonly #configMap = new Map<string, DbosConfig>();

    async dispose() {
        const connections = [...this.#connectionMap.values()];
        this.#connectionMap.clear();
        for (const pool of connections) {
            await pool.end();
        }
    }

    async getConfig(configUri: vscode.Uri): Promise<DbosConfig> {
        const key = configUri.toString();
        let config = this.#configMap.get(key);
        if (!config) {
            config = await loadConfigFile(configUri);
            logger.debug("ConnectionMap.getConfig", {
                configUri: configUri.toString(),
                config
            });
            this.#configMap.set(key, config);
        }
        return config;
    }

    async getConfigConnection(configUri: vscode.Uri, env: CloudDatabaseEnv | undefined): Promise<PoolClient> {
        const key =  env
            ? `${env.DBOS_DBHOST}:${env.DBOS_DBPORT}:${env.DBOS_DBUSER}`
            : configUri.toString();
        let pool = this.#connectionMap.get(key);
        if (!pool) {
            const config = await this.getConfig(configUri);
            if (env) {
                pool = new Pool({ 
                    host: env.DBOS_DBHOST,
                    port: parseInt(env.DBOS_DBPORT),
                    user: env.DBOS_DBUSER,
                    password: env.DBOS_DBPASSWORD,
                    database: config.sysDatabase,
                    ssl: { rejectUnauthorized: false } 
                });
            } else {
                pool = new Pool({ 
                    ...config.poolConfig, 
                    database: config.sysDatabase 
                });
            }
            this.#connectionMap.set(key, pool);
        }
        return await pool.connect();
    }
}

export const connectionMap = new ConnectionMap();

type WFStatus = workflow_status & { created_at: string, updated_at: string };

async function pickWorkflow(workflows: readonly WFStatus[]) {
    const items = workflows.map(status => <vscode.QuickPickItem>{
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

export async function startDebuggingFromCodeLens(
    methodName: string,
    uri: vscode.Uri,
    env: CloudDatabaseEnv | undefined,
) {
    logger.info("startDebuggingFromCodeLens", {
        methodName,
        uri: uri.toString(),
        env: env ?? null
    });

    const configUri = await locateDbosConfigFile(uri);
    logger.info("startDebuggingFromCodeLens", {
        configUri: configUri?.toString() ?? null
    });
    if (!configUri) { return; }

    const client = await connectionMap.getConfigConnection(configUri, env);
    try {
        const result = await client.query<WFStatus>(
            "SELECT * FROM dbos.workflow_status WHERE (status = 'SUCCESS' OR status = 'ERROR') AND name = $1 ORDER BY created_at DESC",
            [methodName]);
        logger.info("startDebuggingFromCodeLens", { 
            rows: result.rows.map(r => ({ workflowID: r.workflow_uuid, status: r.status, created_at: r.created_at }))
        });

        const workflowID = await pickWorkflow(result.rows);
        logger.info("startDebuggingFromCodeLens", { workflowID: workflowID ?? null });
        if (!workflowID) { return; }

        const debugConfig = await getDebugConfig(configUri, workflowID, env);
        logger.info("startDebuggingFromCodeLens", { debugConfig: debugConfig ?? null });
        if (!debugConfig) { return; }

        const folder = vscode.workspace.getWorkspaceFolder(configUri);
        const debuggerStarted = await vscode.debug.startDebugging(folder, debugConfig);
        if (!debuggerStarted) {
            throw new Error("launchDebugger: Debugger failed to start", {
                cause: {
                    configUri,
                    workflowID,
                    debugConfig,
                    folder,
                }
            });
        }
    } catch (e) {
        logger.error("startDebuggingFromCodeLens", e);
    } finally {
        client.release();
    }
}

const nodeExes: ReadonlyArray<string> = ['node', 'npm', 'npx'];

async function getDebugConfig(
    configUri: vscode.Uri,
    workflowID: string,
    env: CloudDatabaseEnv | undefined,
): Promise<vscode.DebugConfiguration> {
    const config = await connectionMap.getConfig(configUri);
    if (config.language && config.language !== "node") {
        throw new Error(`Unsupported language: ${config.language ?? null}`);
    }

    const debugConfig: vscode.DebugConfiguration = {
        type: 'node',
        request: 'launch',
        name: 'Replay Debug',
        cwd: path.dirname(configUri.fsPath),
        env: { 
            ...env, 
            DBOS_DEBUG_WORKFLOW_ID: workflowID,
        }
    };

    const start = config.runtime?.start ?? [];
    if (start.length === 0) {
        debugConfig.runtimeExecutable = "npx";
        debugConfig.args = ['dbos', 'debug', '--uuid', workflowID];
    } else if (start.length === 1) {
        const args = start[0].split(" ");
        if (!nodeExes.includes(args[0])) {
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

interface CloudDatabaseEnv {
    DBOS_DBHOST: string;
    DBOS_DBPORT: string;
    DBOS_DBUSER: string;
    DBOS_DBPASSWORD: string;
    DBOS_DBLOCALSUFFIX: string;
}

export class CodeLensProvider implements vscode.CodeLensProvider {
    constructor(private readonly credManager: CloudCredentialManager) { }

    async #getCloudEnv(config: DbosConfig): Promise<CloudDatabaseEnv | undefined> {
        const cred = await this.credManager.getStoredCredential();
        if (!cred) { return; }

        try {
            const app = await getApp(config.name, cred);
            if (isUnauthorized(app)) { return; }

            const [dbi, dbCred] = await Promise.all([
                getDbInstance(app.PostgresInstanceName, cred),
                getDbCredentials(app.PostgresInstanceName, cred)
            ]);

            if (!isUnauthorized(dbi) && !isUnauthorized(dbCred)) {
                return {
                    DBOS_DBHOST: dbi.HostName,
                    DBOS_DBPORT: `${dbi.Port}`,
                    DBOS_DBUSER: dbi.DatabaseUsername,
                    DBOS_DBPASSWORD: dbCred.Password,
                    DBOS_DBLOCALSUFFIX: "false",
                }
            }

        } catch (error) {
            logger.debug("#getCloudDbInstance", error);
        }
    }

    async provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        try {
            const configUri = await locateDbosConfigFile(document.uri);
            if (!configUri) { return []; }

            const config = await connectionMap.getConfig(configUri);
            const env = await this.#getCloudEnv(config);

            const file = ts.createSourceFile(
                document.fileName,
                document.getText(),
                ts.ScriptTarget.Latest
            );

            const lenses = new Array<vscode.CodeLens>();
            for (const method of getWorkflowMethods(file)) {
                logger.debug("provideCodeLenses", method);
                const start = document.positionAt(method.start);
                const end = document.positionAt(method.end);
                const range = new vscode.Range(start, end);
                const name = method.name;
                lenses.push(new vscode.CodeLens(range, {
                    title: '♻️ Replay Debug',
                    tooltip: `Debug ${name} with the replay debugger`,
                    command: startDebuggingCodeLensCommandName,
                    arguments: [method.name, configUri]
                }));

                if (env) {
                    lenses.push(new vscode.CodeLens(range, {
                        title: '☁️ Cloud Replay Debug',
                        tooltip: `Debug ${name} with the replay debugger`,
                        command: startDebuggingCodeLensCommandName,
                        arguments: [method.name, configUri, env]
                    }));
                }
            }
            return lenses;
        } catch (e) {
            logger.error("provideCodeLenses", e);
            return [];
        }
    }
}

export interface NamedImportInfo {
    name: string;
    alias: string;
    moduleName: string;
}

export interface DecoratorInfo {
    name: string;
    propertyName?: string;
}

export interface StaticMethodInfo {
    name: string;
    className: string | undefined;
    start: number;
    end: number;
    decorators: DecoratorInfo[];
}

export function* getImports(file: ts.SourceFile): Generator<NamedImportInfo, void, unknown> {
    for (const node of file.statements) {
        if (ts.isImportDeclaration(node)) {
            const moduleName = getName(node.moduleSpecifier);
            const bindings = node.importClause?.namedBindings;
            if (!bindings) { continue; }
            else if (ts.isNamedImports(bindings)) {
                for (const binding of bindings.elements) {
                    const name = binding.propertyName?.text ?? binding.name.text;
                    const alias = binding.name.text;
                    yield { name, alias, moduleName };
                }
            }
            else {
                throw Error(`Unsupported NamedImportBindings kind: ${ts.SyntaxKind[node.kind]}`);
            }
        }
    }
}

export function parseDecorator(node: ts.Decorator): DecoratorInfo | undefined {
    if (!ts.isCallExpression(node.expression)) { return; }
    const expr = node.expression.expression;
    if (ts.isIdentifier(expr)) {
        return { name: expr.text, propertyName: undefined };
    }
    if (ts.isPropertyAccessExpression(expr)) {
        return { name: getName(expr.expression), propertyName: expr.name.text };
    }
}

function isValid<T>(value: T | null | undefined): value is T { return !!value; }

export function* getStaticMethods(file: ts.SourceFile): Generator<StaticMethodInfo, void, unknown> {
    for (const node of file.statements) {
        if (ts.isClassDeclaration(node)) {
            const className = node.name?.text;
            for (const memberNode of node.members) {
                if (!ts.isMethodDeclaration(memberNode)) { continue; }

                const isStatic = (memberNode.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.StaticKeyword);
                if (!isStatic) { continue; }

                const decorators = (ts.getDecorators(memberNode) ?? [])
                    .map(parseDecorator)
                    .filter(isValid);
                yield {
                    name: getName(memberNode.name),
                    className,
                    start: memberNode.getStart(file),
                    end: memberNode.getEnd(),
                    decorators,
                };
            }
        }
    }
}

export function* getWorkflowMethods(file: ts.SourceFile) {
    const importMap = new Map<string, NamedImportInfo>();
    for (const imp of getImports(file)) {
        importMap.set(imp.alias, imp);
    }

    for (const method of getStaticMethods(file)) {
        for (const d of method.decorators) {
            const imp = importMap.get(d.name);
            if (!imp) { continue; }
            if (imp.moduleName !== '@dbos-inc/dbos-sdk') { continue; }
            if (imp.name === 'Workflow' && d.propertyName === undefined) {
                yield method;
            }
            else if (imp.name === 'DBOS' && d.propertyName === 'workflow') {
                yield method;
            }
        }
    }
}

function getName(node: ts.PropertyName | ts.Expression | ts.LeftHandSideExpression) {
    switch (true) {
        case ts.isCallExpression(node): return getName(node.expression);
        case ts.isIdentifier(node): return node.text;
        case ts.isStringLiteral(node): return node.text;
        default: throw Error(`Unsupported name kind: ${ts.SyntaxKind[node.kind]}`);
    }
}
