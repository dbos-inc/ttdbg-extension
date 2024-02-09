import * as vscode from 'vscode';
import * as semver from "semver";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { HttpHandlerOptions } from "@aws-sdk/types";
import { PLATFORM, ARCHITECTURE } from './utils';

export interface CloudObject {
  asByteArray(): Promise<Uint8Array>;
}

export interface CloudStorage extends vscode.Disposable {
  downloadVersion(version: string, token?: vscode.CancellationToken): Promise<CloudObject | undefined>;
  getVersions(token?: vscode.CancellationToken): AsyncGenerator<string>;
}

export async function getLatestVersion(versions: AsyncGenerator<string>): Promise<string | undefined> {
  let latestVersion: string | undefined = undefined;
  for await (const version of versions) {
    if (latestVersion === undefined || semver.gt(version, latestVersion)) {
      latestVersion = version;
    }
  }
  return latestVersion;
}

export interface S3CloudStorageOptions {
  region?: string;
  bucket?: string;
  releaseName?: string;
}

export class S3CloudStorage implements CloudStorage {
  private readonly bucket: string;
  private readonly region: string;
  private readonly releaseName: string;
  private readonly s3: S3Client;
  private readonly regexVersion: RegExp;

  constructor(options?: S3CloudStorageOptions) {
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

  async #send<TOut>(sendFunc: (options: HttpHandlerOptions) => Promise<TOut>, token?: vscode.CancellationToken): Promise<TOut> {
    const abort = new AbortController();
    const tokenListener = token?.onCancellationRequested(reason => { abort.abort(reason); });
    try {
      return await sendFunc({ abortSignal: abort.signal });
    } finally {
      tokenListener?.dispose();
    }
  }

  async downloadVersion(version: string, token?: vscode.CancellationToken | undefined): Promise<CloudObject | undefined> {
    const key = `${this.releaseName}/${version}/${this.releaseName}-${PLATFORM}-${ARCHITECTURE}-${version}.zip`;
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key, });
    const response = await this.#send(options => this.s3.send(cmd, options), token);

    const body = response?.Body;
    return body
      ? { asByteArray: () => body.transformToByteArray() }
      : undefined;
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

  dispose() {
    this.s3.destroy();
  }
}

