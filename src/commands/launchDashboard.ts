import * as vscode from 'vscode';
import { logger, config } from '../extension';
import type { DbosMethodInfo } from '../ProvenanceDatabase';
import type { CloudAppNode, CloudDomainNode } from '../CloudDataProvider';
import { createDashboard, getCloudDomain, getDashboard, isUnauthorized } from '../dbosCloudApi';


export const launchDashboardCommandName = "dbos-ttdbg.launch-dashboard";
export async function launchDashboard(node?: string | CloudDomainNode | CloudAppNode, method?: DbosMethodInfo) {
  logger.debug(launchDashboardCommandName, { node: node ?? null });
  if (!node) { return; }

  let domain: string;
  if (typeof node === 'string') {
    const { cloudDomain } = getCloudDomain();
    domain = cloudDomain;
  } else {
    domain = node.domain;
  }

  const credentials = await config.getStoredCloudCredentials(domain);
  if (!credentials) { return; }

  let dashboardUrl = await getDashboard(credentials);
  if (isUnauthorized(dashboardUrl)) { return; }

  if (!dashboardUrl) {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      cancellable: false,
      title: "Creating DBOS dashboard"
    }, async () => { await createDashboard(credentials); });

    const $dashboardUrl = await getDashboard(credentials);
    dashboardUrl = isUnauthorized($dashboardUrl) ? undefined : $dashboardUrl;
  }

  if (!dashboardUrl) {
    vscode.window.showErrorMessage("Failed to create DBOS dashboard");
    return;
  }

  const params = new URLSearchParams();
  if (typeof node === 'string') {
    params.append("var-app_name", node);
  } else if (node.kind === 'cloudApp') {
    params.append("var-app_name", node.app.Name);
  }
  if (method) {
    params.append("var-operation_name", method.name);
    params.append("var-operation_type", method.type.toLowerCase());
  }

  const dashboardQueryUrl = `${dashboardUrl}?${params}`;
  logger.info(`launchDashboardCommand uri`, { uri: dashboardQueryUrl });
  const openResult = await vscode.env.openExternal(vscode.Uri.parse(dashboardQueryUrl));
  if (!openResult) {
    throw new Error(`failed to open dashboard URL: ${dashboardQueryUrl}`);
  }
}
