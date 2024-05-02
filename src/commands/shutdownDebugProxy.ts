import { logger } from '../extension';
import * as DebugProxy from '../DebugProxy';

export function shutdownDebugProxy() {
  logger.debug("shutdownDebugProxy");
  DebugProxy.shutdownDebugProxy();
}
