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
    AppURL: string;
}

export interface DbosCloudDatabase {
    PostgresInstanceName: string;
    HostName: string;
    Status: string;
    Port: number;
    AdminUsername: string;
}

export async function dbosCloudAppStatus(folder: vscode.WorkspaceFolder) {
    const { stdout } = await execFile("npx", ["dbos-cloud", "application", "status", "--json"], {
        cwd: folder.uri.fsPath,
    });
    const json = JSON.parse(stdout) as DbosCloudApp;
    logger.debug("dbos_cloud_app_status", { folder: folder.uri.fsPath, stdout: json });
    return json;
}

export async function dbosCloudDbStatus(folder: vscode.WorkspaceFolder, databaseName: string) {
    const { stdout } = await execFile("npx", ["dbos-cloud", "database", "status", databaseName, "--json"], {
        cwd: folder.uri.fsPath,
    });
    const json = JSON.parse(stdout) as DbosCloudDatabase;
    logger.debug("dbos_cloud_db_status", { folder: folder.uri.fsPath, databaseName, stdout: json });
    return json;
}

export async function dbosCloudDashboardLaunch(folder: vscode.WorkspaceFolder) {
    try {
        const { stdout } = await execFile("npx", ["dbos-cloud", "dashboard", "launch"], {
            cwd: folder.uri.fsPath,
        });
        const regexDashboardLaunch = /Dashboard ready at (.*)$/;
        const match = regexDashboardLaunch.exec(stdout.trim());
        if (match && match.length === 2) {
            const [, dashboardUrl] = match;
            return dashboardUrl;
        }
    } catch { /* ignore errors */ }
    return undefined;
}

export async function dbosCloudDashboardUrl(folder: vscode.WorkspaceFolder) {
    try {
        const { stdout } = await execFile("npx", ["dbos-cloud", "dashboard", "url"], {
            cwd: folder.uri.fsPath,
        });
        const regexDashboardGet = /Dashboard URL is (.*)$/;
        const match = regexDashboardGet.exec(stdout.trim());
        if (match && match.length === 2) {
            const [, dashboardUrl] = match;
            return dashboardUrl;
        }
    } catch { /* ignore errors */ }
    return undefined;
}

export async function dbosCloudLogin(folder: vscode.WorkspaceFolder) {
    logger.debug("dbos_cloud_login", { folder: folder.uri.fsPath });

    const cts = new vscode.CancellationTokenSource();
    const loginProc = cpSpawn("npx", ["dbos-cloud", "login"], { cwd: folder.uri.fsPath });
    const userCodeEmitter = new vscode.EventEmitter<string>();

    const regexLoginInfo = /Login URL: (http.*\/activate\?user_code=([A-Z][A-Z][A-Z][A-Z]-[A-Z][A-Z][A-Z][A-Z]))/;
    const regexSuccessfulLogin = /Successfully logged in as (.*)!/;
    const regexFailedToLogin = /Failed to login:(.*)/;

    try {
        const ctsPromise = new Promise<void>(resolve => {
            cts.token.onCancellationRequested(() => resolve());
        });

        loginProc.on('exit', (code) => { logger.debug("dbos_cloud_login on proc exit", { code }); cts.cancel(); });
        loginProc.on('close', (code) => { logger.debug("dbos_cloud_login on proc close", { code }); cts.cancel(); });
        loginProc.on('error', err => { logger.error("dbos_cloud_login on proc error", err); cts.cancel(); });

        loginProc.stdout.on("data", async (buffer: Buffer) => {
            const data = buffer.toString().trim();
            logger.debug("dbos_cloud_login on stdout data", { data });

            const loginUrlMatch = regexLoginInfo.exec(data);
            if (loginUrlMatch && loginUrlMatch.length === 3) {
                const [, loginUrl, userCode] = loginUrlMatch;
                logger.info("dbos_cloud_login login info", { loginUri: loginUrl, userCode });
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
                logger.info("dbos-dbos_cloud_login successful login", { user });
                vscode.window.showInformationMessage(`Successfully logged in to DBOS Cloud as ${user}`);
            }

            const failedLoginMatch = regexFailedToLogin.exec(data);
            if (failedLoginMatch && failedLoginMatch.length === 2) {
                const [, $reason] = failedLoginMatch;
                const reason = $reason.trim();
                logger.error("dbos-dbos_cloud_login failed to login", { reason });
                vscode.window.showErrorMessage(`Failed to log in to DBOS Cloud: ${reason}`);
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
        logger.debug("dbos_cloud_login exit", { killed, killResult });
    }
}
