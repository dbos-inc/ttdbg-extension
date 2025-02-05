// import * as vscode from 'vscode';
// import { logger } from '../extension';
// import { updateDebugProxy } from '../debugProxy';
// import type { CloudStorage } from '../CloudStorage';

// export function getUpdateDebugProxyCommand(s3: CloudStorage, storageUri: vscode.Uri) {
//   return async function () {
//     logger.debug("updateDebugProxy");
//     updateDebugProxy(s3, storageUri).catch(e => {
//       logger.error("updateDebugProxy", e);
//       vscode.window.showErrorMessage("Failed to update debug proxy");
//     });
//   };
// }
