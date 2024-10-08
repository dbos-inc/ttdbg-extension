import * as vscode from 'vscode';
import { logger, config } from '../extension';
import type { CloudAppNode } from '../CloudDataProvider';
import { launchDebugProxy } from '../debugProxy';
import { getDbInstance, getDbProxyRole, isUnauthorized } from '../dbosCloudApi';
import { validateCredentials } from '../validateCredentials';
import { DbosDebugConfig } from '../Configuration';

function isDebugConfig(node: CloudAppNode | DbosDebugConfig): node is DbosDebugConfig {
  return (node as DbosDebugConfig).host !== undefined;
}

export function getLaunchDebugProxyCommand(storageUri: vscode.Uri) {

  return async function (arg?: CloudAppNode | DbosDebugConfig): Promise<boolean> {
    logger.debug("launchDebugProxy", { app: arg ?? null });
    if (!arg) { return false; }

    let debugConfig: DbosDebugConfig;
    if (isDebugConfig(arg)) {
      debugConfig = arg;
    } else {
      const credentials = await config.getStoredCloudCredentials(arg.domain);
      if (!validateCredentials(credentials)) { return false; }
      
      const { PostgresInstanceName, ApplicationDatabaseName } = arg.app;
      const dbInstance = await getDbInstance(PostgresInstanceName, credentials);
      if (isUnauthorized(dbInstance)) { return false; }

      const role = await getDbProxyRole(PostgresInstanceName, credentials);
      if (isUnauthorized(role)) { return false; }

      debugConfig = {
        host: dbInstance.HostName,
        database: ApplicationDatabaseName + "_dbos_prov",
        user: role.RoleName,
        port: dbInstance.Port,
        password: role.Secret,
      };
    }

    await launchDebugProxy(storageUri, debugConfig)
      .catch(e => {
        logger.error("launchDebugProxy", e);
        vscode.window.showErrorMessage("Failed to launch debug proxy");
      });

    return true;
  };
}
