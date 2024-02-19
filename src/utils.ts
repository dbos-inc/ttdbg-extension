import * as vscode from 'vscode';
import { execFile } from "child_process";

export const PLATFORM = function () {
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

export const ARCHITECTURE = function () {
    switch (process.arch) {
        case "arm64":
            return "arm64";
        case "x64":
            return "x64";
        default:
            throw new Error(`Unsupported architecture: ${process.arch}`);
    }
}();

export function stringify(obj: unknown): string {
    if (typeof obj === 'string') { return obj; }
    if (obj instanceof Error) { return obj.message; }
    if (typeof obj === 'object') { return JSON.stringify(obj); }
    return (obj as any).toString();
}

export async function exists(uri: vscode.Uri): Promise<boolean> {
    return await vscode.workspace.fs.stat(uri)
        .then(_value => true, () => false);
}

export function exec(file: string, args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        execFile(file, args, (error, stdout, stderr) => {
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
}