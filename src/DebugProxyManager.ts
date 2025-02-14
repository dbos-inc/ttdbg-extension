import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams as ChildProcess, spawn } from "child_process";
import jszip from 'jszip';
import * as fs from 'node:fs/promises';
import { execFile as cpExecFile } from "node:child_process";
import { promisify } from 'node:util';
import { logger } from './extension';
import { BlobStorage } from './BlobStorage';
import * as semver from 'semver';
import { Configuration } from './Configuration';
import { CloudAppItem } from './CloudDataProvider';
import { CloudCredentialManager } from './CloudCredentialManager';
import { getDbInstance, getDbProxyRole, isUnauthorized } from './dbosCloudApi';

interface DebugProxyOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  proxyPort?: number;
}

class DebugProxyPseudoterminal implements vscode.Pseudoterminal {
  private readonly onDidWriteEmitter = new vscode.EventEmitter<string>;
  private readonly onDidCloseEmitter = new vscode.EventEmitter<number | void>;
  private process: ChildProcess | undefined;

  readonly onDidWrite = this.onDidWriteEmitter.event;
  readonly onDidClose = this.onDidCloseEmitter.event;

  constructor(
    private readonly exeUri: vscode.Uri,
    private readonly options: DebugProxyOptions
  ) { }

  get isRunning() { return !!this.process && !this.process.exitCode; }

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    const { host, database, password, user, port, proxyPort } = this.options;
    logger.info("Launching Debug Proxy", {
      path: this.exeUri.toString(),
      options: {
        host, database, user,
        port: port ?? null,
        proxyPort: proxyPort ?? null
      }
    });

    const args = [
      "-json",
      "-host", host,
      "-db", database,
      "-user", user,
    ];
    if (port) { args.push("-port", `${port}`); }
    if (proxyPort) { args.push("-listen", `${proxyPort}`); }

    const options = { env: { "PGPASSWORD": password } };

    this.process = spawn(this.exeUri.fsPath, args, options);

    this.process.stdout.on("data", (data: Buffer) => {
      type DebugProxyStdOut = {
        time: string;
        level: string;
        msg: string;
        [key: string]: unknown;
      };

      const { time, level, msg, ...properties } = JSON.parse(data.toString()) as DebugProxyStdOut;
      const escapeCode = getEscapeCode(level);
      this.onDidWriteEmitter.fire("\r\n" + escapeCode + msg.trim());
      for (const [key, value] of Object.entries(properties)) {
        const $value = typeof value === 'object' ? JSON.stringify(value) : `${value}`;
        this.onDidWriteEmitter.fire(`\r\n  ${key}: ${$value}`);
      }
      this.onDidWriteEmitter.fire(ansiReset);
    });
    this.process.stderr.on("data", (data: Buffer) => {
      this.onDidWriteEmitter.fire("\r\n" + ansiRed + data.toString().trim() + "\x1b[0m");
    });
    this.process.on("close", (code) => {
      let message = "DBOS Proxy has exited" + (code ? ` with code ${code}.` : ".");
      this.onDidWriteEmitter.fire("\r\n\r\n" + ansiGreen + `${message}\r\nPress any key to close this terminal` + ansiReset);
      this.process = undefined;
    });
    this.process.on("error", () => {
      this.onDidWriteEmitter.fire("\r\n\r\n" + ansiRed + `DBOS Debug Proxy has encountered an error.\r\nPress any key to close this terminal` + ansiReset);
      this.process = undefined;
    });
  }

  handleInput(data: string): void {
    if (data.charCodeAt(0) === 3) {
      // Ctrl+C
      this.close();
    } else if (this.process?.exitCode === null) {
      this.process.send(data);
    } else {
      this.onDidCloseEmitter.fire();
    }
  }

  close(): void {
    this.process?.kill();
  }
}

class DebugProxyTerminal implements vscode.Disposable {
  constructor(
    private readonly terminal: vscode.Terminal,
    private readonly pty: DebugProxyPseudoterminal,
    readonly options: DebugProxyOptions,
  ) { }

  get isRunning() {
    return this.pty.isRunning;
  }

  dispose() {
    this.terminal.dispose();
  }

  show() {
    this.terminal.show();
  }
}

export class DebugProxyManager implements vscode.Disposable {

  private terminal: DebugProxyTerminal | undefined = undefined;

  constructor(
    private readonly credManager: CloudCredentialManager,
    private readonly storageUri: vscode.Uri) { }

  dispose() {
    this.terminal?.dispose();
  }

  shutdownDebugProxy() {
    const $terminal = this.terminal;
    this.terminal = undefined;
    $terminal?.dispose();
  }

  #proxyRunning(config: DebugProxyOptions) {
    if (!this.terminal) { return false; }
    if (!this.terminal.isRunning) { return false; }
    const options = this.terminal.options;
    return options.host === config.host
      && options.database === config.database
      && options.user === config.user
      && options.port === config.port
      && options.proxyPort === config.proxyPort;
  }

  async launchDebugProxy(options: DebugProxyOptions) {
    options.proxyPort = options.proxyPort ?? Configuration.getProxyPort();
    const exeUri = Configuration.getProxyPath() ?? exeFileName(this.storageUri);
    logger.debug("launchDebugProxy", { ...options, exeUri: exeUri.toString() });

    if (this.#proxyRunning(options)) {
      this.terminal!.show();
      return;
    }

    if (!(await exists(exeUri))) {
      throw new Error("debug proxy doesn't exist", { cause: { path: exeUri.fsPath } });
    }

    this.shutdownDebugProxy();

    const pty = new DebugProxyPseudoterminal(exeUri, options);
    const terminal = vscode.window.createTerminal({
      name: "DBOS Debug Proxy",
      pty: pty,
      iconPath: new vscode.ThemeIcon('debug'),
    });

    this.terminal = new DebugProxyTerminal(terminal, pty, options);
    this.terminal.show();
  }

  async updateDebugProxy(s3: BlobStorage) {
    logger.debug("updateDebugProxy");
    try {
      const pathConfig = Configuration.getProxyPath();
      if (pathConfig !== undefined) {
        const localVersion = await getLocalVersion(pathConfig);
        if (localVersion) {
          logger.info(`Configured Debug Proxy version v${localVersion}.`);
        } else {
          logger.error("Failed to get the version of configured Debug Proxy.");
        }
        return;
      }

      const prerelease = Configuration.getProxyPrerelease();
      const remoteVersion = await getRemoteVersion(s3, prerelease);
      if (remoteVersion === undefined) {
        logger.error("Failed to get the latest version of Debug Proxy.");
        return;
      }
      logger.info(`Debug Proxy remote version v${remoteVersion}.`);

      const exeUri = exeFileName(this.storageUri);
      const localVersion = await getLocalVersion(exeUri);
      if (localVersion && semver.valid(localVersion) !== null) {
        logger.info(`Debug Proxy local version v${localVersion}.`, { uri: exeUri.toString() });
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

          // progress.report({ message: message });
          await downloadRemoteVersion(s3, this.storageUri, remoteVersion, cts.token);
          logger.info(`Debug Proxy updated to v${remoteVersion}.`);
        } finally {
          disposables.forEach(d => d.dispose());
          cts.dispose();
        }
      });
    } catch (e) {
      logger.error("updateDebugProxy", e);
      vscode.window.showErrorMessage("Failed to update debug proxy");
    };
  };

  getUpdateDebugProxyCommand(s3: BlobStorage) {
    const that = this;
    return async function () {
      return that.updateDebugProxy(s3);
    };
  }

  static async #getCredential(credManager: CloudCredentialManager, item: CloudAppItem) {
    const cred = await credManager.getCachedCredential(item.domain);
    if (CloudCredentialManager.isCredentialValid(cred)) { return cred; }
    return await credManager.updateCredential(item.domain, cred);
  }

  getLaunchDebugProxyCommand() {
    const that = this;
    return async function (item?: CloudAppItem) {
      if (!item) { return; }
      logger.debug("launchDebugProxyCommand", item.app);
      if (!item.app.ProvenanceDatabaseName) {
        await vscode.window.showErrorMessage(`Time Travel not enabled for ${item.app.Name} application`);
        return;
      }
      const cred = await DebugProxyManager.#getCredential(that.credManager, item);
      if (!cred) { return; }
      const instanceName = item.app.PostgresInstanceName;

      const [dbi, role] = await Promise.all([
        getDbInstance(instanceName, cred),
        getDbProxyRole(instanceName, cred)
      ]);
      if (isUnauthorized(dbi) || isUnauthorized(role)) { return; }
      const options: DebugProxyOptions = {
        host: dbi.HostName,
        port: dbi.Port,
        user: role.RoleName,
        password: role.Secret,
        database: item.app.ProvenanceDatabaseName,
      };

      await that.launchDebugProxy(options);
    };
  }
}

const IS_WINDOWS = process.platform === "win32";
const EXE_FILE_NAME = `debug-proxy${IS_WINDOWS ? ".exe" : ""}`;

function exeFileName(storageUri: vscode.Uri) {
  return vscode.Uri.joinPath(storageUri, EXE_FILE_NAME);
}

const execFile = promisify(cpExecFile);

function exists(uri: vscode.Uri): Thenable<boolean> {
  return vscode.workspace.fs.stat(uri)
    .then(_value => true, () => false);
}

async function getLocalVersion(exeUri: vscode.Uri) {
  if (!await exists(exeUri)) { return undefined; }
  try {
    const { stdout } = await execFile(exeUri.fsPath, ["-version"]);
    return stdout.trim();
  } catch (e) {
    logger.error("Failed to get local debug proxy version", e);
    return undefined;
  }
}

async function getRemoteVersion(s3: BlobStorage, includePrerelease: boolean, token?: vscode.CancellationToken) {
  let latestVersion: string | undefined = undefined;
  for await (const version of s3.getVersions(token)) {
    if (semver.prerelease(version) && !includePrerelease) {
      continue;
    }
    if (latestVersion === undefined || semver.gt(version, latestVersion)) {
      latestVersion = version;
    }
  }
  return latestVersion;
}

async function downloadRemoteVersion(s3: BlobStorage, storageUri: vscode.Uri, version: string, token?: vscode.CancellationToken) {
  if (!(await exists(storageUri))) {
    await vscode.workspace.fs.createDirectory(storageUri);
  }

  const response = await s3.downloadVersion(version, token);
  if (!response) { throw new Error(`Failed to download version ${version}`); }
  if (token?.isCancellationRequested) { throw new vscode.CancellationError(); }

  const zipFile = await jszip.loadAsync(response);
  if (token?.isCancellationRequested) { throw new vscode.CancellationError(); }

  const files = Object.keys(zipFile.files);
  if (files.length !== 1) { throw new Error(`Expected 1 file, got ${files.length}`); }

  const exeUri = exeFileName(storageUri);
  const exeBuffer = await zipFile.files[files[0]].async("uint8array");
  if (token?.isCancellationRequested) { throw new vscode.CancellationError(); }

  await vscode.workspace.fs.writeFile(exeUri, exeBuffer);
  await fs.chmod(exeUri.fsPath, 0o755);
}

const ansiReset = "\x1b[0m";
const ansiRed = "\x1b[31m";
const ansiGreen = "\x1b[32m";
const ansiYellow = "\x1b[33m";
const ansiBlue = "\x1b[34m";
const ansiMagenta = "\x1b[35m";
const ansiCyan = "\x1b[36m";
const ansiWhite = "\x1b[37m";

function getEscapeCode(level: string) {
  switch (level.toLowerCase()) {
    case "error": return ansiMagenta;
    case "warn": return ansiYellow;
    case "info": return ansiWhite;
    case "debug": return ansiCyan;
    default: return ansiBlue;
  }
}