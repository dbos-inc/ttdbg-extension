import * as vscode from 'vscode';
import { Client } from 'pg';
import { config, logger } from './extension';
import { DbosMethodType, getDbosWorkflowName } from './sourceParser';

export interface workflow_status {
    workflow_uuid: string;
    status: string;
    name: string;
    authenticated_user: string;
    output: string;
    error: string;
    assumed_role: string;
    authenticated_roles: string; // Serialized list of roles.
    request: string; // Serialized HTTPRequest
    executor_id: string; // Set to "local" for local deployment, set to microVM ID for cloud deployment.
}

export class ProvenanceDatabase {
    private _databases: Map<string, Client> = new Map();

    dispose() {
        for (const db of this._databases.values()) {
            db.end(e => logger.error(e));
        }
    }

    private async connect(folder: vscode.WorkspaceFolder): Promise<Client> {
        const existingDB = this._databases.get(folder.uri.fsPath);
        if (existingDB) { return existingDB; }

        const provDbConfig = await config.getProvDbConfig(folder);
        const db = new Client(provDbConfig);
        await db.connect();
        this._databases.set(folder.uri.fsPath, db);
        return db;
    }

    async getWorkflowStatuses(folder: vscode.WorkspaceFolder, name: string, $type: DbosMethodType): Promise<workflow_status[]> {
        const wfName = getDbosWorkflowName(name, $type);
        const db = await this.connect(folder);
        const results = await db.query<workflow_status>('SELECT * FROM dbos.workflow_status WHERE name = $1 LIMIT 10', [wfName]);
        return results.rows;
    }
}
