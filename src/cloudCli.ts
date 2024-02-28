import * as vscode from 'vscode';
import { spawn as cpSpawn } from "child_process";
import { execFile } from './utils';
import { logger } from './extension';

export interface DbosCloudApp {
    Name: string;
    ID: string;
    PostgresInstanceName: string;
    ApplicationDatabaseName: string;
    Status: string;
    Version: string;
}

export interface DbosCloudDatabase {
    PostgresInstanceName: string;
    HostName: string;
    Status: string;
    Port: number;
    AdminUsername: string;
}

async function dbos_cloud_cli<T>(folder: vscode.WorkspaceFolder, ...args: string[]): Promise<T> {
    const { stdout } = await execFile("npx", ["dbos-cloud", ...args, "--json"], {
        cwd: folder.uri.fsPath,
    });
    return JSON.parse(stdout) as T;
}
export async function dbos_cloud_app_status(folder: vscode.WorkspaceFolder) {
    return dbos_cloud_cli<DbosCloudApp>(folder, "application", "status");
}
export async function dbos_cloud_db_status(folder: vscode.WorkspaceFolder, databaseName: string) {
    return dbos_cloud_cli<DbosCloudDatabase>(folder, "database", "status", databaseName);
}

export async function dbos_cloud_login(folder: vscode.WorkspaceFolder) {
    logger.info("dbos_cloud_login", { folder: folder.uri.fsPath });

    const cts = new vscode.CancellationTokenSource();
    const loginProc = cpSpawn("npx", ["dbos-cloud", "login"], { cwd: folder.uri.fsPath });
    const userCodeEmitter = new vscode.EventEmitter<string>();

    const regexLoginUrl = /Login URL: (http.*\/activate\?user_code=([A-Z][A-Z][A-Z][A-Z]-[A-Z][A-Z][A-Z][A-Z]))/;
    const regexSuccessfulLogin = /Successfully logged in as (.*)!/;

    try {
        const ctsPromise = new Promise<void>(resolve => {
            cts.token.onCancellationRequested(() => resolve());
        });

        loginProc.on('exit', () => { logger.info("dbos-cloud login on exit"); cts.cancel(); });
        loginProc.on('close', () => { logger.info("dbos-cloud login on close"); cts.cancel(); });
        loginProc.on('error', err => { logger.error("dbos-cloud login on error", err); cts.cancel(); });

        loginProc.stdout.on("data", async (buffer: Buffer) => {
            const data = buffer.toString().trim();
            logger.info("dbos-cloud login stdout on data", { data });

            const loginUrlMatch = regexLoginUrl.exec(data);
            if (loginUrlMatch && loginUrlMatch.length === 3) {
                const [, loginUrl, userCode] = loginUrlMatch;
                logger.info("dbos-cloud login url", { loginUri: loginUrl, userCode });
                userCodeEmitter.fire(userCode);

                const openResult = await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
                if (!openResult) {
                    logger.error("dbos_cloud_login openExternal failed", { loginUri: loginUrl, userCode });
                    cts.cancel();
                }
            }

            const successfulLoginMatch = regexSuccessfulLogin.exec(data);
            if (successfulLoginMatch && successfulLoginMatch.length === 2) {
                const [, user] = successfulLoginMatch;
                logger.info("dbos-cloud login successful", { user });
                vscode.window.showInformationMessage(`Successfully logged in to DBOS Cloud as ${user}`);
            }
        });

        await vscode.window.withProgress({
            cancellable: true,
            location: vscode.ProgressLocation.Notification,
            title: "Launching browser to log into DBOS Cloud"
        }, async (progress, token) => {
            userCodeEmitter.event(userCode => {
                progress.report({ message: `\nUser code: ${userCode}` });
            });

            token.onCancellationRequested(() => cts.cancel());
            await ctsPromise;
        });
    } finally {
        loginProc.stdout.removeAllListeners();
        loginProc.stderr.removeAllListeners();
        loginProc.removeAllListeners();

        cts.dispose();
        userCodeEmitter.dispose();

        const killed = loginProc.killed;
        const killResult = loginProc.kill();
        logger.info("dbos_cloud_login exit", { killed, killResult });
    }
}
