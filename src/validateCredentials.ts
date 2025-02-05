// import * as vscode from 'vscode';
// import { logger } from './extension';
// import { DbosCloudCredentials } from './dbosCloudApi';
// import jwt from 'jsonwebtoken';

// export function isTokenExpired(authToken: string): boolean {
//     try {
//         const { exp } = jwt.decode(authToken) as jwt.JwtPayload;
//         if (!exp) { return false; }
//         return Date.now() >= exp * 1000;
//     } catch (error) {
//         return true;
//     }
// }

// export function validateCredentials(credentials?: DbosCloudCredentials): credentials is DbosCloudCredentials {
//     if (!credentials) {
//         startInvalidCredentialsFlow(credentials)
//             .catch(e => logger.error("startInvalidCredentialsFlow", e));
//         return false;
//     }

//     if (isTokenExpired(credentials.token)) {
//         startInvalidCredentialsFlow(credentials)
//             .catch(e => logger.error("startInvalidCredentialsFlow", e));
//         return false;
//     }

//     return true;

//     async function startInvalidCredentialsFlow(credentials?: DbosCloudCredentials): Promise<void> {
//         const message = credentials
//             ? "DBOS Cloud credentials have expired. Please login again."
//             : "You need to login to DBOS Cloud.";

//         const items = ["Login", "Cancel"];

//         // TODO: Register support
//         // if (!credentials) { items.unshift("Register"); }
//         const result = await vscode.window.showWarningMessage(message, ...items);
//         switch (result) {
//             // case "Register": break;
//             case "Login":
//                 // await config.cloudLogin();
//                 break;
//         }
//     }
// }
