import * as vscode from 'vscode';
import { logger, config, provDB, debugProxy } from './extension';
import { DbosMethodType } from "./sourceParser";
import { stringify } from './utils';
import { dbos_cloud_login } from './configuration';

export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
export const startDebuggingCommandName = "dbos-ttdbg.startDebugging";
export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export const deleteProvDbPasswordsCommandName = "dbos-ttdbg.delete-prov-db-passwords";

export async function startDebugging(folder: vscode.WorkspaceFolder, name: string, $type: DbosMethodType) {
    try {
        const clientConfig = await config.getProvDbConfig(folder);
        if (!clientConfig) { return; }

        const statuses = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window },
            () => { return provDB.getWorkflowStatuses(clientConfig, name, $type); });

        await debugProxy.launch(clientConfig);

        // TODO: eventually, we'll need a better UI than "list all workflow IDs and let the user pick one"
        const wfID = await vscode.window.showQuickPick(statuses.map(s => s.workflow_uuid), {
            placeHolder: `Select a ${name} workflow ID to debug`,
            canPickMany: false,
        });

        if (!wfID) { return; }

        logger.info(`Starting debugging for ${name} workflow ${wfID}`);

        const proxyURL = `http://localhost:${config.proxyPort ?? 2345}`;
        await vscode.debug.startDebugging(
            vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor!.document.uri),
            {
                name: `Debug ${wfID}`,
                type: 'node-terminal',
                request: 'launch',
                command: `npx dbos-sdk debug -x ${proxyURL} -u ${wfID}`
            }
        );
    } catch (e) {
        const reason = stringify(e);
        logger.error("startDebugging", e);
        vscode.window.showErrorMessage(`Failed to start debugging\n${reason}`);
    }
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