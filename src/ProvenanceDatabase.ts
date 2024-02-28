import { Client, ClientConfig } from 'pg';
import { logger } from './extension';
import { DbosMethodType, getDbosWorkflowName } from './sourceParser';
import { hashClientConfig } from './utils';
import { ProvenanceDatabaseConfig } from './configuration';

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
    created_at: string;
    updated_at: string;
}

export class ProvenanceDatabase {
    private _databases: Map<number, Client> = new Map();

    dispose() {
        for (const db of this._databases.values()) {
            db.end(e => logger.error(e));
        }
    }

    private async connect(dbConfig: ProvenanceDatabaseConfig): Promise<Client> {
        const configHash = hashClientConfig(dbConfig);
        if (!configHash) { throw new Error("Invalid configuration"); }
        const existingDB = this._databases.get(configHash);
        if (existingDB) { return existingDB; }

        const password = typeof dbConfig.password === "function" ? await dbConfig.password() : dbConfig.password;
        if (!password) { throw new Error("Invalid password"); }

        const db = new Client({
            host: dbConfig.host,
            port: dbConfig.port,
            database: dbConfig.database,
            user: dbConfig.user,
            password,
        });
        await db.connect();
        this._databases.set(configHash, db);
        return db;
    }

    async getWorkflowStatuses(clientConfig: ProvenanceDatabaseConfig, name: string, $type: DbosMethodType): Promise<workflow_status[]> {
        const wfName = getDbosWorkflowName(name, $type);
        const db = await this.connect(clientConfig);
        const results = await db.query<workflow_status>('SELECT * FROM dbos.workflow_status WHERE name = $1 ORDER BY created_at DESC LIMIT 10', [wfName]);
        return results.rows;
    }

    async getWorkflowStatus(clientConfig: ProvenanceDatabaseConfig, wfid: string): Promise<workflow_status | undefined> {
        const db = await this.connect(clientConfig);
        const results = await db.query<workflow_status>('SELECT * FROM dbos.workflow_status WHERE workflow_uuid = $1', [wfid]);
        if (results.rows.length > 1) { throw new Error(`Multiple workflow status records found for workflow ID ${wfid}`); }
        return results.rows.length === 1 ? results.rows[0] : undefined;
    }
}
