import { logger } from '../extension';
import * as DebugProxy from '../launchDebugProxy';

export function shutdownDebugProxy() {
  logger.debug("shutdownDebugProxy");
  DebugProxy.shutdownDebugProxy();
}
