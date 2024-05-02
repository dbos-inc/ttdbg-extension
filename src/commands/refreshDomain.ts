import { logger } from '../extension';
import type { CloudDomainNode } from '../CloudDataProvider';

export function getRefreshDomainCommand(refresh: (domain: string) => Promise<void>) {
  return function (node?: CloudDomainNode) {
    logger.debug("refreshDomain", { domain: node ?? null });
    if (node) {
      refresh(node.domain).catch(e => logger.error("refreshDomain", e));
    }
  };
}
