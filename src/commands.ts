import * as vscode from 'vscode';
import { logger, config, provDB, debugProxy } from './extension';
import { DbosMethodType } from "./sourceParser";

export const startDebuggingCommandName = "dbos-ttdbg.startDebugging";
export const launchDebugProxyCommandName = "dbos-ttdbg.launch-debug-proxy";
export const deleteProvenanceDatabasePasswordCommandName = "dbos-ttdbg.delete-prov-db-password";

export async function startDebugging(name: string, $type: DbosMethodType) {
    try {
        const statuses = await provDB.getWorkflowStatuses(name, $type);

        // TODO: eventually, we'll need a better UI than "list all workflow IDs and let the user pick one"
        const wfID = await vscode.window.showQuickPick(statuses.map(s => s.workflow_uuid), {
            placeHolder: `Select a ${name} workflow ID to debug`,
            canPickMany: false,
        });

        if (!wfID) { return; }

        const proxy_port = config.proxyPort ?? 2345;
        const proxyURL = `http://localhost:${proxy_port}`;

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
        logger.error("startDebugging", e);
        vscode.window.showErrorMessage("Failed to start debugging");
    }
}

export async function launchDebugProxy() {
    try {
        await debugProxy.launch();
    } catch (e) {
        logger.error("launchDebugProxy", e);
        vscode.window.showErrorMessage("Failed to launch debug proxy");
    }
}

export async function deleteProvenanceDatabasePassword() {
    try {
        await config.deletePassword();
    } catch (e) {
        logger.error("deleteProvenanceDatabasePassword", e);
    }
}