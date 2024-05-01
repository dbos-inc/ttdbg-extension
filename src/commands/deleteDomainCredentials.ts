import { config, logger } from '../extension';
import type { CloudDomainNode } from '../CloudDataProvider';

export const deleteDomainCredentialsCommandName = "dbos-ttdbg.delete-domain-credentials";
export function getDeleteDomainCredentialsCommand(refresh: (domain: string) => Promise<void>) {
  return async function (node?: CloudDomainNode) {
    logger.debug("deleteDomainCredentials", { domain: node ?? null });
    if (node) {
      const domain = node.domain;
      const changed = await config.deleteStoredCloudCredentials(domain);
      if (changed) {
        await refresh(domain);
      }
    }
  };
}