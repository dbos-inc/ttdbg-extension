import * as vscode from 'vscode';
import { CloudStorage } from './CloudStorage';
import * as childProcess from "child_process";
import { logger } from './extension';
import jszip from 'jszip';
import * as fsp from 'node:fs/promises';
import { DbosMethodType } from "./sourceParser";
import * as semver from 'semver';
import { stringify } from './utils';

const IS_WINDOWS = process.platform === "win32";
const EXE_FILE_NAME = `debug-proxy${IS_WINDOWS ? ".exe" : ""}`;

function exeFileName(storageUri: vscode.Uri) {
    return vscode.Uri.joinPath(storageUri, EXE_FILE_NAME);
}

interface workflow_status {
    workflow_uuid: string;
    status: string;
    name: string;
    authenticated_user: string;
    output: string;
    error: string;
    assumed_role: string;
    authenticated_roles: string; // Serialized list of roles.
    request: string; // Serialized HTTPRequest
    executor_id: string; // Set to "local" for local deployment, set to microVM ID for cloud deployment.
}

async function exists(uri: vscode.Uri) {
    const stat = await vscode.workspace.fs.stat(uri).then(stat => stat, () => undefined);
    return stat !== undefined;
}

function throwOnCancelled(token?: vscode.CancellationToken) {
    if (token?.isCancellationRequested) {
        const abortError = new Error("Request aborted");
        abortError.name = "AbortError";
        throw abortError;
    }
}

export const startDebuggingCommandName = "dbos-ttdbg.startDebugging";

export class DebugProxy {
    constructor(private readonly cloudStorage: CloudStorage, private readonly storageUri: vscode.Uri) {
    }

    dispose() {
    }

    async getWorkflowStatuses(name: string, $type: DbosMethodType): Promise<workflow_status[]> {
        return [];
    }

    async startDebugging(name: string, $type: DbosMethodType) {
        try {
            const statuses = await this.getWorkflowStatuses(name, $type);

            // TODO: eventually, we'll need a better UI than "list all workflow IDs and let the user pick one"
            const wfID = await vscode.window.showQuickPick(statuses.map(s => s.workflow_uuid), {
                placeHolder: `Select a ${name} workflow ID to debug`,
                canPickMany: false,
            });

            if (!wfID) { return; }

            const proxyURL = "http://localhost:2345";

            await vscode.debug.startDebugging(
                vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor!.document.uri),
                {
                    name: `Debug ${wfID}`,
                    type: 'node-terminal',
                    request: 'launch',
                    command: `npx dbos-sdk debug -x ${proxyURL} -u ${wfID}`
                }
            );
        } catch (e) {
            logger.error(e);
        }
    }

    async getVersion() {
        const localVersion = await this._getLocalVersion();
        const msg = localVersion ? `Debug Proxy v${localVersion} installed` : "Debug Proxy not installed";
        logger.info(msg);
        await vscode.window.showInformationMessage(msg);
    }

    async update() {
        const remoteVersion = await this._getRemoteVersion();
        if (remoteVersion === undefined) {
            logger.error("Failed to get the latest version of Debug Proxy.");
            return;
        }
        logger.info(`Debug Proxy remote version v${remoteVersion}.`);

        const localVersion = await this._getLocalVersion();
        if (localVersion && semver.valid(localVersion) !== null) {
            logger.info(`Debug Proxy local version v${localVersion}.`);
            if (semver.satisfies(localVersion, `>=${remoteVersion}`, { includePrerelease: true })) { 
                return; 
            }
        }

        const msg = localVersion
            ? `Updating DBOS Debug Proxy to v${remoteVersion}.`
            : `Installing DBOS Debug Proxy v${remoteVersion}.`;
        logger.info(msg);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            cancellable: true
        }, async (progress, token) => {
            progress.report({ message: msg });
            await this._downloadRemoteVersion(remoteVersion, token);
            logger.info(`Debug Proxy updated to v${remoteVersion}.`);
        }).then(undefined, reason => {
            logger.error("Failed to update Debug Proxy", reason);
            vscode.window.showErrorMessage("Failed to update Debug Proxy");
        });
    }

    async _getLocalVersion() {
        const exeUri = exeFileName(this.storageUri);
        if (!(await exists(exeUri))) {
            return Promise.resolve(undefined);
        }

        try {
            return await new Promise<string | undefined>((resolve, reject) => {
                childProcess.execFile(exeUri.fsPath, ["-version"], (error, stdout, stderr) => {
                    if (error) {
                        reject(error);
                    } else {
                        if (stderr) {
                            reject(stderr);
                        } else {
                            resolve(stdout.trim());
                        }
                    }
                });
            });
        } catch (e) {
            logger.error("Failed to get local debug proxy version", e);
            return undefined;
        }
    }

    async _getRemoteVersion(token?: vscode.CancellationToken) {
        const versions = this.cloudStorage.getVersions(token);

        let latestVersion: string | undefined = undefined;
        for await (const version of versions) {
          if (latestVersion === undefined || semver.gt(version, latestVersion)) {
            latestVersion = version;
          }
        }
        return latestVersion;
    }

    async _downloadRemoteVersion(version: string, token?: vscode.CancellationToken) {
        if (!(await exists(this.storageUri))) {
            await vscode.workspace.fs.createDirectory(this.storageUri);
        }

        const response = await this.cloudStorage.downloadVersion(version, token);
        if (!response) { throw new Error(`Failed to download version ${version}`); }
        throwOnCancelled(token);

        const zipFile = await jszip.loadAsync(response.asByteArray());
        throwOnCancelled(token);

        const files = Object.keys(zipFile.files);
        if (files.length !== 1) { throw new Error(`Expected 1 file, got ${files.length}`); }

        const exeUri = exeFileName(this.storageUri);
        const exeBuffer = await zipFile.files[files[0]].async("uint8array");
        throwOnCancelled(token);

        await vscode.workspace.fs.writeFile(exeUri, exeBuffer);
        await fsp.chmod(exeUri.fsPath, 0o755);
    }
}