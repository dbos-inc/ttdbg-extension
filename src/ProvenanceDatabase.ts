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
    private _db: Client | undefined;

    dispose() {
        this._db?.end(e => logger.error(e));
    }

    async connect(): Promise<Client> {
        if (this._db) { return this._db; }

        const db = new Client(config.provDbConfig);
        await db.connect();
        this._db = db;
        return db;
    }

    async getWorkflowStatuses(name: string, $type: DbosMethodType): Promise<workflow_status[]> {
        const wfName = getDbosWorkflowName(name, $type);
        const db = await this.connect();
        const results = await db.query<workflow_status>('SELECT * FROM dbos.workflow_status WHERE name = $1 LIMIT 10', [wfName]);
        return results.rows;
    }
}
