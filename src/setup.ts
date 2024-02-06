import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import * as vscode from 'vscode';
import logger, { errorMsg } from "./logger";
import * as jszip from 'jszip';
import * as fsp from 'node:fs/promises';
import * as childProcess from "child_process";
import * as semver from "semver";

const BUCKET = "dbos-releases";
const PREFIX = "debug-proxy";
const REGEX_DEBUG_PROXY = /^debug-proxy\/(?<Version>.*)\/$/;
const IS_WINDOWS = process.platform === "win32";
const EXE_FILE_NAME = `debug-proxy${IS_WINDOWS ? ".exe" : ""}`;

function exeFileName(storageUri: vscode.Uri) {
    return vscode.Uri.joinPath(storageUri, EXE_FILE_NAME);
}

export async function getLatestRemoteVersion(s3: S3Client): Promise<string | undefined> {
    let latestVersion: string | undefined = undefined;
    for await (const version of getRemoteVersions(s3)) {
        if (latestVersion === undefined || semver.gt(version, latestVersion)) {
            latestVersion = version;
        }
    }
    return latestVersion;
}

export async function* getRemoteVersions(s3: S3Client): AsyncGenerator<string> {
    let $token: string | undefined = undefined;
    while (true) {
        const cmd: ListObjectsV2Command = new ListObjectsV2Command({
            Bucket: BUCKET,
            Delimiter: "/",
            Prefix: `${PREFIX}/`,
            ContinuationToken: $token,
        });
        const response = await s3.send(cmd);
        for (const prefix of response.CommonPrefixes ?? []) {
            const version = REGEX_DEBUG_PROXY.exec(prefix.Prefix ?? "")?.groups?.Version;
            if (semver.valid(version)) {
                yield version!;
            }
        }
        if (response.IsTruncated) {
            $token = response.NextContinuationToken;
        } else {
            break;
        }
    }
}

function getPlatform(): "linux" | "macos" | "windows" {
    switch (process.platform) {
        case "linux":
            return "linux";
        case "darwin":
            return "macos";
        case "win32":
            return "windows";
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}

function getArch(): "arm64" | "x64" {
    switch (process.arch) {
        case "arm64":
            return "arm64";
        case "x64":
            return "x64";
        default:
            throw new Error(`Unsupported architecture: ${process.arch}`);
    }
}

async function exists(uri: vscode.Uri) {
    const stat = await vscode.workspace.fs.stat(uri).then((stat) => stat, () => undefined);
    return stat !== undefined;
}

export async function getLocalVersion(storageUri: vscode.Uri) {

    const exeUri = exeFileName(storageUri);
    if (!exists(exeUri)) {
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
    } catch {
        return undefined;
    }
}

export async function downloadVersion(s3: S3Client, version: string, storageUri: vscode.Uri, token?: vscode.CancellationToken) {
    if (!exists(storageUri)) {
        await vscode.workspace.fs.createDirectory(storageUri);
    }

    const abort = new AbortController();
    const tokenListener = token?.onCancellationRequested(() => {
        abort.abort();
    });

    try {
        const cmd = new GetObjectCommand({
            Bucket: BUCKET,
            Key: `${PREFIX}/${version}/${PREFIX}-${getPlatform()}-${getArch()}-${version}.zip`,
        });
        logger.trace(cmd.input, "downloadVersion");

        const response = await s3.send(cmd, { abortSignal: abort.signal });
        if (token?.isCancellationRequested ?? false) { return; }
        if (!response.Body) { throw new Error("invalid body"); }

        const zipFile = await jszip.loadAsync(response.Body.transformToByteArray());
        if (token?.isCancellationRequested ?? false) { return; }

        const files = Object.keys(zipFile.files);
        if (files.length !== 1) { throw new Error(`Expected 1 file, got ${files.length}`); }

        const exeUri = exeFileName(storageUri);
        const exeBuffer = await zipFile.files[files[0]].async("uint8array");
        if (token?.isCancellationRequested ?? false) { return; }

        await vscode.workspace.fs.writeFile(exeUri, exeBuffer);
        await fsp.chmod(exeUri.fsPath, 0o755);
    } finally {
        tokenListener?.dispose();
    }
}
