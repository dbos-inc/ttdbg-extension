import * as vscode from 'vscode';
import { logger } from '../extension';
import { updateDebugProxy } from '../DebugProxy';
import type { CloudStorage } from '../CloudStorage';


export const updateDebugProxyCommandName = "dbos-ttdbg.update-debug-proxy";
export function getUpdateDebugProxyCommand(s3: CloudStorage, storageUri: vscode.Uri) {
  return async function () {
    logger.debug(updateDebugProxyCommandName);
    updateDebugProxy(s3, storageUri).catch(e => {
      logger.error("updateDebugProxy", e);
      vscode.window.showErrorMessage("Failed to update debug proxy");
    });
  };
}
