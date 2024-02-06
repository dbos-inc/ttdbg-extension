import * as vscode from 'vscode';
import debugProxy from './DebugProxy';
import { launchDebugger, launchDebuggerCommandName, } from './commands';
import { TTDbgCodeLensProvider } from './codeLensProvider';
import logger from './logger';
import { S3Client } from '@aws-sdk/client-s3';
import { downloadVersion, getLatestRemoteVersion, getLocalVersion } from './setup';

export function activate(context: vscode.ExtensionContext): Promise<void> {

  // updateDebugProxy returns a promise, but activation doesn't need to wait for it to complete
  updateDebugProxy(context.globalStorageUri);

  context.subscriptions.push(
    vscode.commands.registerCommand(launchDebuggerCommandName, launchDebugger));
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      new TTDbgCodeLensProvider()
    ));

  return Promise.resolve();
}

export function deactivate(): Promise<void> {
  logger.dispose();
  debugProxy.dispose();
  return Promise.resolve();
}

async function updateDebugProxy(storageUri: vscode.Uri): Promise<void> {
  // Note: setting the signer to an identity function is a workaround for a bug in the AWS SDK
  // https://github.com/aws/aws-sdk-js-v3/issues/2321#issuecomment-916336230
  const s3 = new S3Client({ region: "us-east-2", signer: { sign: async (request) => request } });

  const remoteVersion = await getLatestRemoteVersion(s3);
  if (remoteVersion === undefined) {
    logger.error("Failed to get the latest version of Debug Proxy.");
    return;
  }

  const localVersion = await getLocalVersion(storageUri);
  if (localVersion && localVersion === remoteVersion) {
    logger.info(`Debug Proxy is up to date (v${remoteVersion}).`);
    return;
  }

  const msg = localVersion 
    ? `Updating DBOS Debug Proxy from v${localVersion} to v${remoteVersion}.`
    : `Installing DBOS Debug Proxy v${remoteVersion}.`;

  logger.info(msg);
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    cancellable: true
  }, async (progress, token) => {
    progress.report({ message: msg });
    await downloadVersion(s3, remoteVersion, storageUri, token);
  });




  // const localVersion = await getLocalVersion(storageUri);
  // if (localVersion === remoteVersion) {
  //   logger.info(`Debug Proxy is up to date (v${remoteVersion}).`);
  //   return;
  // }



  

}
