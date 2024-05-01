import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams as ChildProcess, spawn } from "child_process";
import jszip from 'jszip';
import * as fs from 'node:fs/promises';
import * as semver from 'semver';
import { CloudStorage } from './CloudStorage';
import { config, logger } from './extension';
import { execFile, exists, hashClientConfig } from './utils';
import { DbosDebugConfig } from './configuration';

const IS_WINDOWS = process.platform === "win32";
const EXE_FILE_NAME = `debug-proxy${IS_WINDOWS ? ".exe" : ""}`;

function exeFileName(storageUri: vscode.Uri) {
    return vscode.Uri.joinPath(storageUri, EXE_FILE_NAME);
}

async function getLocalVersion(storageUri: vscode.Uri) {
    const exeUri = exeFileName(storageUri);
    if (!(await exists(exeUri))) {
      return Promise.resolve(undefined);
    }
  
    try {
      const { stdout } = await execFile(exeUri.fsPath, ["-version"]);
      return stdout.trim();
    } catch (e) {
      logger.error("Failed to get local debug proxy version", e);
      return undefined;
    }
  }
  
  async function getRemoteVersion(s3: CloudStorage, options?: UpdateDebugProxyOptions) {
    const includePrerelease = options?.includePrerelease ?? false;
    let latestVersion: string | undefined = undefined;
    for await (const version of s3.getVersions(options?.token)) {
      if (semver.prerelease(version) && !includePrerelease) {
        continue;
      }
      if (latestVersion === undefined || semver.gt(version, latestVersion)) {
        latestVersion = version;
      }
    }
    return latestVersion;
  }
  
  async function downloadRemoteVersion(s3: CloudStorage, storageUri: vscode.Uri, version: string, token?: vscode.CancellationToken) {
    if (!(await exists(storageUri))) {
      await vscode.workspace.fs.createDirectory(storageUri);
    }
  
    const response = await s3.downloadVersion(version, token);
    if (!response) { throw new Error(`Failed to download version ${version}`); }
    if (token?.isCancellationRequested) { throw new vscode.CancellationError(); }
  
    const zipFile = await jszip.loadAsync(response.asByteArray());
    if (token?.isCancellationRequested) { throw new vscode.CancellationError(); }
  
    const files = Object.keys(zipFile.files);
    if (files.length !== 1) { throw new Error(`Expected 1 file, got ${files.length}`); }
  
    const exeUri = exeFileName(storageUri);
    const exeBuffer = await zipFile.files[files[0]].async("uint8array");
    if (token?.isCancellationRequested) { throw new vscode.CancellationError(); }
  
    await vscode.workspace.fs.writeFile(exeUri, exeBuffer);
    await fs.chmod(exeUri.fsPath, 0o755);
  }
  
  interface UpdateDebugProxyOptions {
    includePrerelease?: boolean;
    token?: vscode.CancellationToken;
  }
  
  export async function updateDebugProxy(s3: CloudStorage, storageUri: vscode.Uri, options?: UpdateDebugProxyOptions) {
    logger.debug("updateDebugProxy", { storageUri: storageUri.fsPath, includePrerelease: options?.includePrerelease ?? false });
  
    const remoteVersion = await getRemoteVersion(s3, options);
    if (remoteVersion === undefined) {
      logger.error("Failed to get the latest version of Debug Proxy.");
      return;
    }
    logger.info(`Debug Proxy remote version v${remoteVersion}.`);
  
    const localVersion = await getLocalVersion(storageUri);
    if (localVersion && semver.valid(localVersion) !== null) {
      logger.info(`Debug Proxy local version v${localVersion}.`);
      if (semver.satisfies(localVersion, `>=${remoteVersion}`, { includePrerelease: true })) {
        return;
      }
    }
  
    const message = localVersion
      ? `Updating DBOS Debug Proxy to v${remoteVersion}.`
      : `Installing DBOS Debug Proxy v${remoteVersion}.`;
    logger.info(message);
  
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: message,
      cancellable: true
    }, async (_, token) => {
      // create a CTS so we can cancel via withProgress token or options token
      const cts = new vscode.CancellationTokenSource();
      const disposables = new Array<vscode.Disposable>();
      try {
        token.onCancellationRequested(() => cts.cancel(), undefined, disposables);
        options?.token?.onCancellationRequested(() => cts.cancel(), undefined, disposables);
  
        // progress.report({ message: message });
        await downloadRemoteVersion(s3, storageUri, remoteVersion, cts.token);
        logger.info(`Debug Proxy updated to v${remoteVersion}.`);
      } finally {
        disposables.forEach(d => d.dispose());
        cts.dispose();
      }
    });
  }

  








export class DebugProxy {
    private _outChannel: vscode.LogOutputChannel;
    private _proxyProcesses: Map<number, ChildProcess> = new Map();

    constructor(private readonly cloudStorage: CloudStorage, private readonly storageUri: vscode.Uri) {
        this._outChannel = vscode.window.createOutputChannel("DBOS Debug Proxy", { log: true });
    }

    dispose() {
        this.shutdown();
    }

    shutdown() {
        for (const [key, process] of this._proxyProcesses.entries()) {
            this._proxyProcesses.delete(key);
            logger.info(`Debug Proxy shutting down`, { folder: key, pid: process.pid });
            process.stdout.removeAllListeners();
            process.stderr.removeAllListeners();
            process.removeAllListeners();
            process.kill();
        }
    }

    async launch(clientConfig: DbosDebugConfig, folder: vscode.WorkspaceFolder): Promise<boolean> {
        const configHash = hashClientConfig(clientConfig);

        if (!configHash) { throw new Error("Invalid configuration"); }
        if (this._proxyProcesses.has(configHash)) { return true; }

        const exeUri = exeFileName(this.storageUri);
        const exeExists = await exists(exeUri);
        if (!exeExists) {
            throw new Error("Debug proxy not installed");
        }

        const proxy_port = config.getProxyPort(folder);
        let { host, port, database, user, password } = clientConfig;
        if (typeof password === "function") { 
            const $password = await password();
            if ($password) { 
                password = $password; 
            } else {
                return false;
            }
        }

        const args = [
            "-json",
            "-host", host,
            "-db", database,
            "-user", user,
        ];
        if (port) {
            args.push("-port", `${port}`);
        }
        if (proxy_port) {
            args.push("-listen", `${proxy_port}`);
        }

        const proxyProcess = spawn(
            exeUri.fsPath,
            args,
            {
                env: {
                    "PGPASSWORD": password
                }
            }
        );
        logger.info(`Debug Proxy launched`, { port: proxy_port, pid: proxyProcess.pid, database });
        this._proxyProcesses.set(configHash, proxyProcess);

        proxyProcess.stdout.on("data", (data: Buffer) => {
            const { time, level, msg, ...properties } = JSON.parse(data.toString()) as { time: string, level: string, msg: string, [key: string]: unknown };
            const $properties = { ...properties, database };
            switch (level.toLowerCase()) {
                case "debug":
                    this._outChannel.debug(msg, $properties);
                    break;
                case "info":
                    this._outChannel.info(msg, $properties);
                    break;
                case "warn":
                    this._outChannel.warn(msg, $properties);
                    break;
                case "error":
                    this._outChannel.error(msg, $properties);
                    break;
                default:
                    this._outChannel.appendLine(`${time} [${level}] ${msg} ${JSON.stringify($properties)}`);
                    break;
            }
        });

        proxyProcess.on("error", e => {
            this._outChannel.error(e, { database });
        });

        proxyProcess.on('close', (code, signal) => {
            this._proxyProcesses.delete(configHash);
            this._outChannel.info(`Debug Proxy closed with exit code ${code}`, { database });
        });

        proxyProcess.on("exit", (code, _signal) => {
            this._proxyProcesses.delete(configHash);
            this._outChannel.info(`Debug Proxy exited with exit code ${code}`, { database });
        });

        return true;
    }
}