import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams as ChildProcess, spawn } from "child_process";
import jszip from 'jszip';
import * as fs from 'node:fs/promises';
import { execFile as cpExecFile } from "node:child_process";
import { promisify } from 'node:util';
import * as semver from 'semver';
import { CloudStorage } from './CloudStorage';
import { logger } from './extension';
import { exists } from './utility';
import { DbosDebugConfig } from './Configuration';

const IS_WINDOWS = process.platform === "win32";
const EXE_FILE_NAME = `debug-proxy${IS_WINDOWS ? ".exe" : ""}`;

function exeFileName(storageUri: vscode.Uri) {
  return vscode.Uri.joinPath(storageUri, EXE_FILE_NAME);
}

const execFile = promisify(cpExecFile);

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

let terminal: DebugProxyTerminal | undefined = undefined;

export function shutdownDebugProxy() {
  if (terminal) {
    const $terminal = terminal;
    terminal = undefined;
    $terminal.dispose();
  }
}

export async function launchDebugProxy(storageUri: vscode.Uri, options: DbosDebugConfig & { proxyPort?: number }) {

  const exeUri = exeFileName(storageUri);
  logger.debug("launchDebugProxy", { exeUri, launchOptions: options });
  if (!(await exists(exeUri))) {
    throw new Error("debug proxy doesn't exist", { cause: { path: exeUri.fsPath } });
  }

  if (terminal?.matches(options)) { return; }
  shutdownDebugProxy();  

  const password = typeof options.password === 'function' ? await options.password() : options.password;
  if (!password) { throw new Error("Invalid password"); }

  terminal = new DebugProxyTerminal(exeUri, { ...options, password });
  terminal.show();
}

class DebugProxyTerminal implements vscode.Disposable {

  private readonly pty: DebugProxyPseudoterminal;
  private readonly terminal: vscode.Terminal;

  constructor(
    exeUri: vscode.Uri,
    private readonly options: DebugProxyTerminalOptions,
  ) {
    this.pty = new DebugProxyPseudoterminal(exeUri, options);
    this.terminal = vscode.window.createTerminal({
      name: "DBOS Debug Proxy",
      pty: this.pty,
      iconPath: new vscode.ThemeIcon('debug'),
    });
  }

  get isRunning() { 
    return this.pty.isRunning; 
  }

  dispose() {
    this.terminal.dispose();
  }

  show() {
    this.terminal.show();
  }

  matches(config: DbosDebugConfig) {
    if (!this.isRunning) { return false; }
    return this.options.host === config.host
      && this.options.database === config.database
      && this.options.user === config.user
      && this.options.port === config.port;
  }
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

interface DebugProxyTerminalOptions {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
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
    private readonly options: DebugProxyTerminalOptions
  ) { }

  get isRunning() { return !!this.process && !this.process.exitCode; }

  open(_: vscode.TerminalDimensions | undefined): void {
    const { host, database, password, user, port, proxyPort } = this.options;
    logger.info("Launching Debug Proxy", { path: this.exeUri.fsPath, launchOptions: { host, database, user, port, proxyPort } });

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
