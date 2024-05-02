import * as vscode from 'vscode';
import { logger } from '../extension';
import { shutdownDebugProxy as $shutdownDebugProxy } from '../DebugProxy';

export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export function shutdownDebugProxy() {
  logger.debug("shutdownDebugProxy");
  $shutdownDebugProxy();
}
