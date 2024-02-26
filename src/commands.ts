import * as vscode from 'vscode';
import { logger, config, provDB, debugProxy } from './extension';
import { DbosMethodType } from "./sourceParser";
import { getWorkspaceFolder, stringify } from './utils';
import { dbos_cloud_login } from './configuration';
import { ClientConfig } from 'pg';

export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
export const startDebuggingCodeLensCommandName = "dbos-ttdbg.start-debugging-code-lens";
export const startDebuggingUriCommandName = "dbos-ttdbg.start-debugging-uri";
export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export const deleteProvDbPasswordsCommandName = "dbos-ttdbg.delete-prov-db-passwords";

async function startDebugging(folder: vscode.WorkspaceFolder, clientConfig: ClientConfig, workflowID: string) {
    try {
        logger.info(`startDebugging`, { folder: folder.uri.fsPath, database: clientConfig.database, workflowID });
        await debugProxy.launch(clientConfig);

        const proxyURL = `http://localhost:${config.proxyPort ?? 2345}`;
        await vscode.debug.startDebugging(
            vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor!.document.uri),
            {
                name: `Debug ${workflowID}`,
                type: 'node-terminal',
                request: 'launch',
                command: `npx dbos-sdk debug -x ${proxyURL} -u ${workflowID}`
            }
        );
    } catch (e) {
        logger.error("startDebugging", e);
        vscode.window.showErrorMessage(`Failed to start debugging\n${stringify(e)}`);
    }
}

export async function startDebuggingFromCodeLens(folder: vscode.WorkspaceFolder, name: string, $type: DbosMethodType) {
    const clientConfig = await config.getProvDbConfig(folder);
    if (!clientConfig) { return; }

    logger.info(`startDebuggingFromCodeLens`, { folder: folder.uri.fsPath, database: clientConfig.database, name, type: $type });

    const statuses = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window },
        () => { return provDB.getWorkflowStatuses(clientConfig, name, $type); });

    // TODO: eventually, we'll need a better UI than "list all workflow IDs and let the user pick one"
    const wfid = await vscode.window.showQuickPick(statuses.map(s => s.workflow_uuid), {
        placeHolder: `Select a ${name} workflow ID to debug`,
        canPickMany: false,
    });

    if (!wfid) { return; }

    await startDebugging(folder, clientConfig, wfid);

}
export async function startDebuggingFromUri(wfid: string) {
    const folder = await getWorkspaceFolder();
    if (!folder) { return; } 
    const clientConfig = await config.getProvDbConfig(folder);
    if (!clientConfig) { return; }

    logger.info(`startDebuggingFromUri`, { folder: folder.uri.fsPath, database: clientConfig.database, wfid });

    const validStatus = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window },
        () => { return provDB.getWorkflowStatus(clientConfig, wfid); });

    if (validStatus.length === 0) {
        vscode.window.showErrorMessage(`Workflow ID ${wfid} not found in provenance database`);
        return;
    }

    await startDebugging(folder, clientConfig, wfid);
}

export function shutdownDebugProxy() {
    try {
        debugProxy.shutdown();
    } catch (e) {
        logger.error("shutdownDebugProxy", e);
    }
}

export async function deleteProvenanceDatabasePasswords() {
    try {
        await config.deletePasswords();
    } catch (e) {
        logger.error("deleteProvenanceDatabasePasswords", e);
    }
}

export async function cloudLogin() {
    try {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 1) {
            await dbos_cloud_login(folders[0]);
        } else {
            throw new Error("This command only works when exactly one workspace folder is open");
        }
    } catch (e) {
        logger.error("cloudLogin", e);
    }
}