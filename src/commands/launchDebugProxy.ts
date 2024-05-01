import * as vscode from 'vscode';
import { logger, config } from '../extension';
import type { CloudAppNode } from '../CloudDataProvider';
import { launchDebugProxy } from '../DebugProxy';
import { getDbInstance, isUnauthorized } from '../dbosCloudApi';

export const launchDebugProxyCommandName = "dbos-ttdbg.launch-debug-proxy";
export function getLaunchDebugProxyCommand(storageUri: vscode.Uri) {

  return async function (node?: CloudAppNode) {
    logger.debug(launchDebugProxyCommandName, { app: node ?? null });
    if (!node) { return; }

    const credentials = await config.getStoredCloudCredentials(node.domain);
    if (!credentials) { return; }

    const { PostgresInstanceName, ApplicationDatabaseName } = node.app;
    const dbInstance = await getDbInstance(PostgresInstanceName, credentials);
    if (isUnauthorized(dbInstance)) { return; }

    const debugConfig = {
      host: dbInstance.HostName,
      database: ApplicationDatabaseName + "_dbos_prov",
      user: dbInstance.DatabaseUsername,
      port: dbInstance.Port,
    };
    const password = await config.getAppDatabasePassword(debugConfig);
    if (!password) { return; }

    launchDebugProxy(storageUri, { ...debugConfig, password })
      .catch(e => {
        logger.error("launchDebugProxy", e);
        vscode.window.showErrorMessage("Failed to launch debug proxy");
      });
  };
}
