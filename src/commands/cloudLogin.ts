import { logger, cloudDataProvider } from '../extension';
import type { CloudDomainNode } from '../CloudDataProvider';


export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
export async function cloudLogin(node?: CloudDomainNode) {
  logger.debug("cloudLogin", { domain: node ?? null });
  if (node) {
    cloudDataProvider.login(node.domain).catch(e => logger.error("cloudLogin", e));
  }
}
