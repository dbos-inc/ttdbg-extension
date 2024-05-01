import { logger, cloudDataProvider } from '../extension';
import type { CloudDomainNode } from '../CloudDataProvider';


export const refreshDomainCommandName = "dbos-ttdbg.refresh-domain";
export async function refreshDomain(node?: CloudDomainNode) {
  logger.debug("refreshDomain", { domain: node ?? null });
  if (node) {
    cloudDataProvider.refresh(node).catch(e => logger.error("refreshDomain", e));
  }
}
