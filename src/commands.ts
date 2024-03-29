import * as vscode from 'vscode';
import { logger, debugProxy, config } from './extension';
import { getDebugConfigFolder, getWorkspaceFolder } from './utils';
import { DbosMethodInfo } from './ProvenanceDatabase';
import { startDebugging, showWorkflowPick, validateCredentials } from './userFlows';
import { DbosCloudDomain, getCloudDomain } from './dbosCloudApi';
import { CloudAppNode } from './CloudDataProvider';
import { getDebugConfigFromDbosCloud } from './configuration';

export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
export async function cloudLogin(host?: string) {
  logger.debug("cloudLogin", { host });
  try {
    await config.cloudLogin(host);
  } catch (e) {
    logger.error("cloudLogin", e);
  }
}

export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export function shutdownDebugProxy() {
  logger.debug("shutdownDebugProxy");
  try {
    debugProxy.shutdown();
  } catch (e) {
    logger.error("shutdownDebugProxy", e);
  }
}

export const deleteDomainCredentialsCommandName = "dbos-ttdbg.delete-domain-credentials";
export async function deleteDomainCredentials(domain?: string | DbosCloudDomain) {
  logger.debug("deleteDomainCredentials", { domain: domain ?? null });

  try {
    domain = getCloudDomain(domain);
    logger.info("deleteDomainCredentials", domain);
    await config.deleteStoredCloudCredentials(domain);
  } catch (e) {
    logger.error("shutdownDebugProxy", { domain: domain ?? null, error: e });
  }
}

export const deleteAppDatabasePasswordCommandName = "dbos-ttdbg.delete-app-db-password";
export async function deleteAppDatabasePassword(node?: CloudAppNode) {
  logger.debug("deleteAppDatabasePassword", { node: node ?? null });
  if (node) {
    const debugConfig = await getDebugConfigFromDbosCloud(node.app, node.credentials);
    if (debugConfig) {
      try {
        await config.deleteStoredAppDatabasePassword(debugConfig);
      } catch (e) {
        logger.error("deleteAppDatabasePassword", e);
      }
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

    const proxyLaunched = await debugProxy.launch(cloudConfig, folder);
    if (!proxyLaunched) {
      throw new Error("Failed to launch debug proxy", { cause: { folder: folder.uri.fsPath, cloudConfig } });
    }

    return `http://localhost:${config.getProxyPort(folder)}`;
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
