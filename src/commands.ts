import * as vscode from 'vscode';
import { ProvenanceDatabase } from "./ProvenanceDatabase";
import { DbosMethodType } from "./sourceParser";
import { logger, config } from './extension';

export const startDebuggingCommandName = "dbos-ttdbg.startDebugging";
export const launchDebugProxyCommandName = "dbos-ttdbg.launch-debug-proxy";
export const deleteProvDBPasswordCommandName = "dbos-ttdbg.delete-prov-db-password";

export async function startDebugging(db: ProvenanceDatabase, name: string, $type: DbosMethodType) {
    try {
        const statuses = await db.getWorkflowStatuses(name, $type);

        // TODO: eventually, we'll need a better UI than "list all workflow IDs and let the user pick one"
        const wfID = await vscode.window.showQuickPick(statuses.map(s => s.workflow_uuid), {
            placeHolder: `Select a ${name} workflow ID to debug`,
            canPickMany: false,
        });

        if (!wfID) { return; }

        const proxyURL = "http://localhost:2345";

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
        logger.error(e);
    }
}

export async function launchDebugProxy(db: ProvenanceDatabase) {
    try {
        // const exeUri = exeFileName(this.storageUri);
        // if (!(await exists(exeUri))) {
        //     logger.error("Debug proxy not installed");
        //     vscode.window.showErrorMessage("Debug Proxy not installed");
        // }

        // try {
        //     const cfg = await this.getProvDbConfig();
        //     if (!cfg) { return; }

        //     this._prov_client = new Client(cfg);
        //     await this._prov_client.connect();

        //     const results = await this._prov_client.query<workflow_status>('SELECT * FROM dbos.workflow_status LIMIT 10');
        //     logger.info("connected to prov DB");



            // this._proxyProcess?.kill();

            // this._proxyProcess = childProcess.spawn(exeUri.fsPath, [
            //     "-json",
            //     "-host", host,
            //     "-port", `${port}`,
            //     "-db", name,
            //     "-user", user,
            // ], {
            //     env: {
            //         "PGPASSWORD": password
            //     }
            // });

            // this._proxyProcess.stdout.on("data", (data: Buffer) => {
            //     const { time, level, msg, ...properties } = JSON.parse(data.toString()) as { time: string, level: string, msg: string, [key: string]: unknown };
            //     logger.log(level.toLowerCase(), "Debug Proxy > " + msg, properties);
            // });

            // this._proxyProcess.on("error", e => {
            //     logger.error(e);
            // });

            // this._proxyProcess.on("exit", (code, signal) => {
            //     logger.warn("Debug Proxy exited", { code, signal });
            // });

    } catch (e) {
        logger.error(e);
    }
}

export async function deleteProvenanceDatabasePassword(db: ProvenanceDatabase) {
    try {
        await config.deletePassword();
    } catch (e) {
        logger.error(e);
    }
}