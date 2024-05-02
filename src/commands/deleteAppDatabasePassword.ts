import { logger, config } from '../extension';
import type { CloudAppNode } from '../CloudDataProvider';
import { getDebugConfigFromDbosCloud } from '../configuration';

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
