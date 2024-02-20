import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams as ChildProcess, spawn, execFile as cpExecFile } from "child_process";
import util from 'util';
import jszip from 'jszip';
import * as fs from 'node:fs/promises';
import * as semver from 'semver';
import { CloudStorage } from './CloudStorage';
import { config, logger } from './extension';
import { exists } from './utils';

const execFile = util.promisify(cpExecFile);

const IS_WINDOWS = process.platform === "win32";
const EXE_FILE_NAME = `debug-proxy${IS_WINDOWS ? ".exe" : ""}`;

function exeFileName(storageUri: vscode.Uri) {
    return vscode.Uri.joinPath(storageUri, EXE_FILE_NAME);
}

function throwOnCancelled(token?: vscode.CancellationToken) {
    if (token?.isCancellationRequested) {
        const abortError = new Error("Request aborted");
        abortError.name = "AbortError";
        throw abortError;
    }
}

export class DebugProxy {
    private _outChannel: vscode.LogOutputChannel;
    private _proxyProcess: ChildProcess | undefined;

    constructor(private readonly cloudStorage: CloudStorage, private readonly storageUri: vscode.Uri) {
        this._outChannel = vscode.window.createOutputChannel("DBOS Debug Proxy", { log: true });
    }

    dispose() {
        this.shutdown();
    }

    shutdown() {
        if (this._proxyProcess) {
            const process = this._proxyProcess;
            this._proxyProcess = undefined;
            logger.info(`Debug Proxy shutting down`, { pid: process.pid });
            process.stdout.removeAllListeners();
            process.stderr.removeAllListeners();
            process.removeAllListeners();
            process.kill();
        }
    }

    async launch() {
        if (this._proxyProcess) { return; }

        const exeUri = exeFileName(this.storageUri);
        const exeExists = await exists(exeUri);
        if (!exeExists) {
            throw new Error("Debug proxy not installed");
        }

        const proxy_port = config.proxyPort;
        let { host, port, database, user, password } = config.provDbConfig;
        if (typeof password === "function") {
            password = await password();
        }
        if (!host || !database || !user || !password) {
            throw new Error("Invalid configuration");
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

        this._proxyProcess = spawn(
            exeUri.fsPath,
            args,
            {
                env: {
                    "PGPASSWORD": password
                }
            }
        );
        logger.info(`Debug Proxy launched`, { port: proxy_port, pid: this._proxyProcess.pid });

        this._proxyProcess.stdout.on("data", (data: Buffer) => {
            const { time, level, msg, ...properties } = JSON.parse(data.toString()) as { time: string, level: string, msg: string, [key: string]: unknown };
            switch (level.toLowerCase()) {
                case "debug":
                    this._outChannel.debug(msg, properties);
                    break;
                case "info":
                    this._outChannel.info(msg, properties);
                    break;
                case "warn":
                    this._outChannel.warn(msg, properties);
                    break;
                case "error":
                    this._outChannel.error(msg, properties);
                    break;
                default:
                    this._outChannel.appendLine(`${time} [${level}] ${msg} ${JSON.stringify(properties)}`);
                    break;
            }
        });

        this._proxyProcess.on("error", e => {
            this._outChannel.error(e);
        });

        this._proxyProcess.on("exit", (code, _signal) => {
            this._outChannel.info(`Debug Proxy exited with exit code ${code}`);
        });
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
        });
    }

    async _getLocalVersion() {
        const exeUri = exeFileName(this.storageUri);
        if (!(await exists(exeUri))) {
            return Promise.resolve(undefined);
        }

        try {
            const {stdout, stderr} = await execFile(exeUri.fsPath, ["-version"]);
            if (stderr) { throw new Error(stderr); }
            return stdout.trim();
        } catch (e) {
            logger.error("Failed to get local debug proxy version", e);
            return undefined;
        }
    }

    async _getRemoteVersion(token?: vscode.CancellationToken) {
        let latestVersion: string | undefined = undefined;
        for await (const version of this.cloudStorage.getVersions(token)) {
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
        await fs.chmod(exeUri.fsPath, 0o755);
    }
}