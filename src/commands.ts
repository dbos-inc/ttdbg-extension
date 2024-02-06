import * as vscode from 'vscode';
import logger from "./logger";
import { DbosMethodType } from "./sourceParser";
import debugProxy from './DebugProxy';
import { S3Client } from "@aws-sdk/client-s3";
import { getLocalVersion } from './setup';

export const launchDebuggerCommandName = "dbos-ttdbg.launchDebugger";
export const sayHelloCommandName = "dbos-ttdbg.sayHello";

export async function launchDebugger(name: string, $type: DbosMethodType) {
    try {
        const statuses = await debugProxy.getWorkflowStatuses(name, $type);

        // TODO: eventually, we'll need a better UI than "list all workflow IDs and let the user pick one"
        const wfID = await vscode.window.showQuickPick(statuses.map(s => s.workflow_uuid), {
            placeHolder: `Select a ${name} workflow ID to debug`,
            canPickMany: false,
        });

        if (!wfID) { return; }

        await debugProxy.launchDebugger(wfID);
    } catch (e) {
        logger.error(e);
    }
}

// const regex = /^debug-proxy\/(?<Version>.*)\/$/;

// function getPlatform(): "linux" | "macos" | "windows" {
//     switch (process.platform) {
//         case "linux":
//             return "linux";
//         case "darwin":
//             return "macos";
//         case "win32":
//             return "windows";
//         default:
//             throw new Error(`Unsupported platform: ${process.platform}`);
//     }
// }

// function getArch(): "arm64" | "x64" {
//     switch (process.arch) {
//         case "arm64":
//             return "arm64";
//         case "x64":
//             return "x64";
//         default:
//             throw new Error(`Unsupported architecture: ${process.arch}`);
//     }
// }

// const BUCKET = "dbos-releases";
// const PREFIX = "debug-proxy";

// async function latestVersion(s3: S3Client) {
//     const cmd = new ListObjectsV2Command({
//         Bucket: BUCKET,
//         Delimiter: "/",
//         Prefix: `${PREFIX}/`,
//     });
//     const response = await s3.send(cmd);
//     const versions = (response.CommonPrefixes ?? [])
//         .map(v => regex.exec(v.Prefix ?? "")?.groups?.Version)
//         .filter(function (v?: string): v is string { return v !== undefined; })
//         .sort((a, b) => semver.compare(b, a))
//         ;

//     return versions.length === 0 ? undefined : versions[0];
// }

// const isWindows = process.platform === "win32";

// async function downloadVersion(s3: S3Client, version: string, storageUri: vscode.Uri) {
//     await vscode.workspace.fs.createDirectory(storageUri);

//     const cmd = new GetObjectCommand({
//         Bucket: BUCKET,
//         Key: `${PREFIX}/${version}/${PREFIX}-${getPlatform()}-${getArch()}-${version}.zip`,
//     });
//     logger.trace(cmd.input, "downloadVersion");

//     const response = await s3.send(cmd);
//     if (!response.Body) { throw new Error("invalid body"); }

//     const zip = await jszip.loadAsync(response.Body.transformToByteArray());
//     const files = Object.keys(zip.files);
//     if (files.length !== 1) { throw new Error(`Expected 1 file, got ${files.length}`); }

//     const exeUri = vscode.Uri.joinPath(storageUri, `debug-proxy${isWindows ? ".exe" : ""}`);
//     const proxyBuffer = await zip.files[files[0]].async("uint8array");
//     await vscode.workspace.fs.writeFile(exeUri, proxyBuffer);
//     await fsp.chmod(exeUri.fsPath, 0o755);
// }

export async function downloadDebugProxy(storageUri: vscode.Uri) {
    // Note: setting the signer to an identity function is a workaround for a bug in the AWS SDK
    // https://github.com/aws/aws-sdk-js-v3/issues/2321#issuecomment-916336230
    const s3 = new S3Client({ region: "us-east-2", signer: { sign: async (request) => request } });

    const localVersion = await getLocalVersion(storageUri);
    // const remoteVersion = await getRemoteVersion(s3);


    // await vscode.window.withProgress({
    //     title: "Installing Zig...",
    //     location: vscode.ProgressLocation.Notification,
    // }, async progress => {

    //     try {
    //         progress.report({ message: "Discovering debug-proxy version..." });
    //         const version = await latestVersion(client);
    //         if (!version) {
    //             throw new Error("No debug-proxy versions found");
    //         }
    
    //         progress.report({ message: `Installing debug-proxy v${version}` });
    //         await downloadVersion(client, version, storageUri);
    //     } catch (e) {
    //         const msg = errorMsg(e);
    //         await vscode.window.showErrorMessage(msg);
    //     } finally {
    //         client.destroy();
    //     }
    

    // });


}
