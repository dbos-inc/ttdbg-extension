import { logger, cloudDataProvider } from '../extension';
import type { CloudDomainNode } from '../CloudDataProvider';


export const deleteDomainCredentialsCommandName = "dbos-ttdbg.delete-domain-credentials";
export async function deleteDomainCredentials(node?: CloudDomainNode) {
  logger.debug("deleteDomainCredentials", { domain: node ?? null });
  if (node) {
    cloudDataProvider.logout(node.domain).catch(e => logger.error("deleteDomainCredentials", e));
  }
}
