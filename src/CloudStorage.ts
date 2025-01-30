import * as vscode from 'vscode';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { HttpHandlerOptions } from "@aws-sdk/types";
import * as semver from "semver";

const PLATFORM = function () {
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
}();

const ARCHITECTURE = function () {
  switch (process.arch) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x64";
    default:
      throw new Error(`Unsupported architecture: ${process.arch}`);
  }
}();

export interface CloudStorage {
  downloadVersion(version: string, token?: vscode.CancellationToken): Promise<Uint8Array | undefined>;
  getVersions(token?: vscode.CancellationToken): AsyncGenerator<string>;
}

export class S3CloudStorage implements CloudStorage {
  private readonly bucket: string;
  private readonly region: string;
  private readonly releaseName: string;
  private readonly s3: S3Client;
  private readonly regexVersion: RegExp;

  constructor(options?: {
    region?: string;
    bucket?: string;
    releaseName?: string;
  }) {
    this.bucket = options?.bucket ?? "dbos-releases";
    this.region = options?.region ?? "us-east-2";
    this.releaseName = options?.releaseName ?? "debug-proxy";
    this.regexVersion = new RegExp(`^${this.releaseName}\/(?<Version>.*)\/$`);

    // Note: Using an identity signer function is a workaround for an AWS SDk issue
    // https://github.com/aws/aws-sdk-js-v3/issues/2321#issuecomment-916336230
    this.s3 = new S3Client({
      region: this.region,
      signer: { sign: (request) => Promise.resolve(request) }
    });
  }

  dispose() {
    this.s3.destroy();
  }

  async #send<TOut>(sendFunc: (options: HttpHandlerOptions) => Promise<TOut>, token?: vscode.CancellationToken): Promise<TOut> {
    const abort = new AbortController();
    const tokenListener = token?.onCancellationRequested(reason => { abort.abort(reason); });
    try {
      return await sendFunc({ abortSignal: abort.signal });
    } finally {
      tokenListener?.dispose();
    }
  }

  async downloadVersion(version: string, token?: vscode.CancellationToken | undefined): Promise<Uint8Array | undefined> {
    const key = `${this.releaseName}/${version}/${this.releaseName}-${PLATFORM}-${ARCHITECTURE}-${version}.zip`;
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key, });
    const response = await this.#send(options => this.s3.send(cmd, options), token);
    return await response.Body?.transformToByteArray();
  }

  async* getVersions(token?: vscode.CancellationToken | undefined): AsyncGenerator<string> {
    const cmd: ListObjectsV2Command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Delimiter: "/",
      Prefix: `${this.releaseName}/`,
    });

    while (true) {
      const { CommonPrefixes, IsTruncated, NextContinuationToken } = await this.#send(options => this.s3.send(cmd, options), token);
      for (const prefix of CommonPrefixes ?? []) {
        const version = this.regexVersion.exec(prefix.Prefix ?? "")?.groups?.Version;
        if (version && semver.valid(version) !== null) {
          yield version;
        }
      }

      if (!IsTruncated) { break; }
      if (!NextContinuationToken) { break; } // (should not happen, but just in case...)
      cmd.input.ContinuationToken = NextContinuationToken;
    }
  }
}

