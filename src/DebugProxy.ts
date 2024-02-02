import * as vscode from 'vscode';
import { DbosMethodType, getDbosWorkflowName } from './sourceParser';
import { Pool } from 'pg';
import logger, { errorMsg } from './logger';

export const CONFIG_SECTION = "dbos-ttdbg";
export const DEBUG_PROXY_URL = "debug_proxy_url";

interface workflow_status {
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

export class DebugProxy {
  private _proxyUrl: string = "";
  private _db: Pool | undefined;
  private _listener: vscode.Disposable;

  constructor() {
    this._listener = vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        this.#onConfigChange();
      }
    });
    this.#onConfigChange();
  }

  dispose() {
    this._listener.dispose();
    this._db?.end();
  }

  #onConfigChange() {
    const proxyUrl = vscode.workspace.getConfiguration(CONFIG_SECTION).get(DEBUG_PROXY_URL, "http://localhost:2345");
    if (proxyUrl === this._proxyUrl) { return; }

    this._proxyUrl = proxyUrl;
    
    const $db = this._db;
    this._db = undefined;

    try {
      const authority = vscode.Uri.parse(proxyUrl).authority;
      const [host, path] = authority.split(':');

      if (host && path) {
        this._db = new Pool({
          host,
          port: parseInt(path),
        });
      }
    } finally {
      $db?.end();
    }
  }

  async getWorkflowStatuses(name: string, $type: DbosMethodType): Promise<workflow_status[]> {
    if (!this._db) { return []; }

    try {
      const wfName = getDbosWorkflowName(name, $type);
      const results = await this._db.query<workflow_status>('SELECT * FROM dbos.workflow_status WHERE name = $1', [wfName]);
      return results.rows;
    } catch (e) {
      const msg = errorMsg(e);
      vscode.window.showErrorMessage(msg);
      logger.error(msg);
      return [];
    }
  }

  async launchDebugger(wfID: string): Promise<boolean> { 
    return await vscode.debug.startDebugging(
			vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor!.document.uri),
			{
				name: `Debug ${wfID}`,
				type: 'node-terminal',
				request: 'launch',
				command: `npx dbos-sdk debug -x ${this._proxyUrl} -u ${wfID}`
			}
		);
  }
}

const debugProxy = new DebugProxy();
export default debugProxy;
