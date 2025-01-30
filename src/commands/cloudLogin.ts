import { logger } from '../extension';
import type { CloudDomainNode } from '../CloudDataProvider';
import { validateCredentials } from '../validateCredentials';

export function getCloudLoginCommand(refresh: (domain: string) => Promise<void>) {
  return async function (node?: CloudDomainNode) {
    // logger.debug("cloudLogin", { domain: node ?? null });
    // if (node) {
    //   const domain = node.domain;
    //   const credentials = await config.getStoredCloudCredentials(domain);
    //   if (!validateCredentials(credentials)) { return; }

    //   await config.cloudLogin(domain);
    //   await refresh(domain);
    // }
  };
}
