// import * as vscode from 'vscode';
// import { Client, ClientConfig, Pool, PoolClient } from 'pg';
// // import { getDbosWorkflowName, type DbosMethodInfo } from './CodeLensProvider';
// import type { DbosDebugConfig } from './Configuration';
// import { logger } from './extension';

// export interface workflow_status {
//   workflow_uuid: string;
//   status: string;
//   name: string;
//   authenticated_user: string;
//   output: string;
//   error: string;
//   assumed_role: string;
//   authenticated_roles: string; // Serialized list of roles.
//   request: string; // Serialized HTTPRequest
//   executor_id: string; // Set to "local" for local deployment, set to microVM ID for cloud deployment.
//   created_at: string;
//   updated_at: string;
// }

// function getClientConfig(debugConfig: DbosDebugConfig): ClientConfig {
//   const { password } = debugConfig;
//   const pgPassword = typeof password === 'string' ? password : async () => {
//     const pwd = await password();
//     if (!pwd) { throw new Error("Invalid password"); }
//     return pwd;
//   };

//   return {
//     host: debugConfig.host,
//     port: debugConfig.port,
//     database: debugConfig.database,
//     user: debugConfig.user,
//     password: pgPassword,
//     ssl: { rejectUnauthorized: false }
//   };
// }

// const connections = new Map<string, Pool>();

// function getConnectionString(debugConfig: DbosDebugConfig): string {
//   const { host, port, database, user } = debugConfig;
//   return `postgres://${user}:@${host}:${port}/${database}`;
// }

// function getPool(debugConfig: DbosDebugConfig): Pool {
//   const key = getConnectionString(debugConfig);
//   let pool = connections.get(key);
//   if (!pool) { 
//     pool = new Pool(getClientConfig(debugConfig));
//     connections.set(key, pool);
//   }
//   return pool;
// }

// export function shutdownProvenanceDbConnectionPool() {
//   for (const pool of connections.values()) {
//     pool.end().catch(e => logger.error("Failed to end pool", e));
//   }
// }

// function isPgError(e: any): e is { code: string } {
//   return 'code' in e;
// }


// // export async function getWorkflowStatuses(debugConfig: DbosDebugConfig, method?: DbosMethodInfo): Promise<workflow_status[]> {
// //   const client = await getPoolClient();
// //   try {
// //     const results = method
// //       ? await client.query<workflow_status>('SELECT * FROM dbos.workflow_status WHERE name = $1 ORDER BY created_at DESC LIMIT 10', [getDbosWorkflowName(method.name, method.type)])
// //       : await client.query<workflow_status>('SELECT * FROM dbos.workflow_status ORDER BY created_at DESC LIMIT 10');
// //     return results.rows;
// //   } finally {
// //     client.release();
// //   }

// //   async function getPoolClient(): Promise<PoolClient> {
// //     try {
// //       return await getPool(debugConfig).connect();
// //     } catch (e) {
// //       if (isPgError(e) && e.code === '3D000') {
// //         throw new Error(`Provenance database does not exist. This app was not deployed with --enable-timetravel.`);
// //       } else {
// //         throw e;
// //       }
// //     }
// //   }
// // }

// export async function getWorkflowStatus(debugConfig: DbosDebugConfig, workflowID: string): Promise<workflow_status | undefined> {
//   const client = await getPool(debugConfig).connect();
//   try {
//     const results = await client.query<workflow_status>('SELECT * FROM dbos.workflow_status WHERE workflow_uuid = $1', [workflowID]);
//     if (results.rows.length > 1) { throw new Error(`Multiple workflow status records found for workflow ID ${workflowID}`); }
//     return results.rows.length === 1 ? results.rows[0] : undefined;
//   } finally {
//     client.release();
//   }
// }
