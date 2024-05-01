import * as vscode from 'vscode';
import { logger } from '../extension';


export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export function shutdownDebugProxy() {
  logger.debug("shutdownDebugProxy");
  // TODO
  vscode.window.showErrorMessage("shutdownDebugProxy currently disabled");
  // try {
  //   debugProxy.shutdown();
  // } catch (e) {
  //   logger.error("shutdownDebugProxy", e);
  // }
}
