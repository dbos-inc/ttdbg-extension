import * as vscode from 'vscode';
import { logger, config, cloudDataProvider } from './extension';
import { getDebugConfigFolder, getWorkspaceFolder } from './utils';
import type { DbosMethodInfo } from './ProvenanceDatabase';
import { startDebugging, showWorkflowPick, validateCredentials } from './userFlows';
import type { CloudAppNode, CloudDomainNode } from './CloudDataProvider';
import { getDebugConfigFromDbosCloud } from './configuration';
import { launchDebugProxy, updateDebugProxy } from './DebugProxy';
import type { CloudStorage } from './CloudStorage';
import { getDbInstance, isUnauthorized } from './dbosCloudApi';

export const updateDebugProxyCommandName = "dbos-ttdbg.update-debug-proxy";
export function getUpdateDebugProxyCommand(s3: CloudStorage, storageUri: vscode.Uri) {
  return async function () {
    logger.debug(updateDebugProxyCommandName);
    updateDebugProxy(s3, storageUri).catch(e => {
      logger.error("updateDebugProxy", e);
      vscode.window.showErrorMessage("Failed to update debug proxy");
    });
  };
}

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

export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export function shutdownDebugProxy() {
  logger.debug("shutdownDebugProxy");
  // TODO
  vscode.window.showErrorMessage("shutdownDebugProxy currently disabled");
  // try {
  //   debugProxy.shutdown();
  // } catch (e) {
  //   logger.error("shutdownDebugProxy", e);
  // }
}

export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
export async function cloudLogin(node?: CloudDomainNode) {
  logger.debug("cloudLogin", { domain: node ?? null });
  if (node) {
    cloudDataProvider.login(node.domain).catch(e => logger.error("cloudLogin", e));
  }
}

export const deleteDomainCredentialsCommandName = "dbos-ttdbg.delete-domain-credentials";
export async function deleteDomainCredentials(node?: CloudDomainNode) {
  logger.debug("deleteDomainCredentials", { domain: node ?? null });
  if (node) {
    cloudDataProvider.logout(node.domain).catch(e => logger.error("deleteDomainCredentials", e));
  }
}

export const refreshDomainCommandName = "dbos-ttdbg.refresh-domain";
export async function refreshDomain(node?: CloudDomainNode) {
  logger.debug("refreshDomain", { domain: node ?? null });
  if (node) {
    cloudDataProvider.refresh(node).catch(e => logger.error("refreshDomain", e));
  }
}

export const deleteAppDatabasePasswordCommandName = "dbos-ttdbg.delete-app-db-password";
export async function deleteAppDatabasePassword(node?: CloudAppNode) {
  logger.debug("deleteAppDatabasePassword", { node: node ?? null });
  if (node) {
    const credentials = await config.getStoredCloudCredentials(node.domain);
    if (!credentials) { return; }
    const debugConfig = await getDebugConfigFromDbosCloud(node.app, credentials);
    if (!debugConfig) { return; }
    try {
      await config.deleteStoredAppDatabasePassword(debugConfig);
    } catch (e) {
      logger.error("deleteAppDatabasePassword", e);
    }
  }
}

export const deleteStoredPasswordsCommandName = "dbos-ttdbg.delete-stored-passwords";
export async function deleteStoredPasswords() {
  logger.debug("deleteStoredPasswords");
  try {
    await config.deletePasswords();
  } catch (e) {
    logger.error("deleteProvenanceDatabasePasswords", e);
  }
}

export const getProxyUrlCommandName = "dbos-ttdbg.get-proxy-url";
export async function getProxyUrl(cfg?: vscode.DebugConfiguration & { rootPath?: string }) {
  try {
    const folder = getDebugConfigFolder(cfg);
    const credentials = await config.getStoredCloudCredentials();
    if (!validateCredentials(credentials)) { return undefined; }
    const cloudConfig = await config.getDebugConfig(folder, credentials);

    // TODO
    vscode.window.showErrorMessage("getProxyUrl currently disabled");
    return undefined;

    // const proxyLaunched = await launchDebugProxy(folder, cloudConfig);
    // if (!proxyLaunched) {
    //   throw new Error("Failed to launch debug proxy", { cause: { folder: folder.uri.fsPath, cloudConfig } });
    // }

    // return `http://localhost:${config.getProxyPort(folder)}`;
  } catch (e) {
    logger.error("getProxyUrl", e);
    vscode.window.showErrorMessage(`Failed to get proxy URL`);
  }
}

export const pickWorkflowIdCommandName = "dbos-ttdbg.pick-workflow-id";
export async function pickWorkflowId(cfg?: vscode.DebugConfiguration) {
  try {
    const folder = getDebugConfigFolder(cfg);
    const credentials = await config.getStoredCloudCredentials();
    if (!validateCredentials(credentials)) { return undefined; }
    const cloudConfig = await config.getDebugConfig(folder, credentials);

    return await showWorkflowPick(folder, { cloudConfig });
  } catch (e) {
    logger.error("pickWorkflowId", e);
    vscode.window.showErrorMessage("Failed to get workflow ID");
  }
}

export const startDebuggingUriCommandName = "dbos-ttdbg.start-debugging-uri";
export async function startDebuggingFromUri(workflowID: string) {
  try {
    const folder = await getWorkspaceFolder();
    if (!folder) { return; }

    logger.info(`startDebuggingFromUri`, { folder: folder.uri.fsPath, workflowID });
    await startDebugging(folder, async () => { return workflowID; });
  } catch (e) {
    logger.error("startDebuggingFromUri", e);
    vscode.window.showErrorMessage(`Failed to debug ${workflowID} workflow`);
  }
}

export const startDebuggingCodeLensCommandName = "dbos-ttdbg.start-debugging-code-lens";
export async function startDebuggingFromCodeLens(folder: vscode.WorkspaceFolder, method: DbosMethodInfo) {
  try {
    logger.info(`startDebuggingFromCodeLens`, { folder: folder.uri.fsPath, method });
    await startDebugging(folder, async (cloudConfig) => {
      return await showWorkflowPick(folder, { cloudConfig, method });
    });
  } catch (e) {
    logger.error("startDebuggingFromCodeLens", e);
    vscode.window.showErrorMessage(`Failed to debug ${method.name} method`);
  }
}
