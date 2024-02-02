import * as vscode from 'vscode';
import logger from "./logger";
import { DbosMethodType } from "./sourceParser";
import debugProxy from './DebugProxy';

export const launchDebuggerCommandName = "dbos-ttdbg.launchDebugger";

export async function launchDebugger(name: string, $type: DbosMethodType) {
    try {
        const statuses = await debugProxy.getWorkflowStatuses(name, $type);

        // TODO: eventually, we'll need a better UI than "list all workflow IDs and let the user pick one"
        const wfID = await vscode.window.showQuickPick(statuses.map(s => s.workflow_uuid), {
            placeHolder: `Select a ${name} workflow ID to debug`,
            canPickMany: false,
        });

        if (!wfID) { return; }
 
        await debugProxy.launchDebugger(wfID);
    } catch (e) {
        logger.error(e);
    }
}
