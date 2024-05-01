import * as vscode from 'vscode';
import type { CloudStorage } from '../CloudStorage';
import { cloudLoginCommandName, cloudLogin } from './cloudLogin';
import { deleteAppDatabasePasswordCommandName, deleteAppDatabasePassword } from './deleteAppDatabasePassword';
import { deleteDomainCredentialsCommandName, deleteDomainCredentials } from './deleteDomainCredentials';
import { deleteStoredPasswordsCommandName, deleteStoredPasswords } from './deleteStoredPasswords';
import { getProxyUrlCommandName, getProxyUrl } from './getProxyUrl';
import { launchDashboardCommandName, launchDashboard } from './launchDashboard';
import { launchDebugProxyCommandName, getLaunchDebugProxyCommand } from './launchDebugProxy';
import { pickWorkflowIdCommandName, pickWorkflowId } from './pickWorkflowId';
import { refreshDomainCommandName, refreshDomain } from './refreshDomain';
import { shutdownDebugProxyCommandName, shutdownDebugProxy } from './shutdownDebugProxy';
import { startDebuggingCodeLensCommandName, startDebuggingFromCodeLens } from './startDebuggingFromCodeLens';
import { startDebuggingUriCommandName, startDebuggingFromUri } from './startDebuggingFromUri';
import { updateDebugProxyCommandName, getUpdateDebugProxyCommand } from './updateDebugProxy';

export { cloudLoginCommandName } from "./cloudLogin";
export { deleteAppDatabasePasswordCommandName } from "./deleteAppDatabasePassword";
export { deleteDomainCredentialsCommandName } from "./deleteDomainCredentials";
export { deleteStoredPasswordsCommandName } from "./deleteStoredPasswords";
export { getProxyUrlCommandName } from "./getProxyUrl";
export { launchDashboardCommandName } from "./launchDashboard";
export { launchDebugProxyCommandName } from "./launchDebugProxy";
export { pickWorkflowIdCommandName } from "./pickWorkflowId";
export { refreshDomainCommandName } from "./refreshDomain";
export { shutdownDebugProxyCommandName } from "./shutdownDebugProxy";
export { startDebuggingCodeLensCommandName } from "./startDebuggingFromCodeLens";
export { startDebuggingUriCommandName } from "./startDebuggingFromUri";
export { updateDebugProxyCommandName } from "./updateDebugProxy";

export function registerCommands(cloudStorage: CloudStorage, storageUri: vscode.Uri) {
    const disposables = [
        vscode.commands.registerCommand(cloudLoginCommandName, cloudLogin),
        vscode.commands.registerCommand(deleteDomainCredentialsCommandName, deleteDomainCredentials),
        vscode.commands.registerCommand(deleteAppDatabasePasswordCommandName, deleteAppDatabasePassword),
        vscode.commands.registerCommand(deleteStoredPasswordsCommandName, deleteStoredPasswords),
        vscode.commands.registerCommand(shutdownDebugProxyCommandName, shutdownDebugProxy),
        vscode.commands.registerCommand(startDebuggingCodeLensCommandName, startDebuggingFromCodeLens),
        vscode.commands.registerCommand(startDebuggingUriCommandName, startDebuggingFromUri),
        vscode.commands.registerCommand(refreshDomainCommandName, refreshDomain),
        vscode.commands.registerCommand(updateDebugProxyCommandName, getUpdateDebugProxyCommand(cloudStorage, storageUri)),
        vscode.commands.registerCommand(launchDebugProxyCommandName, getLaunchDebugProxyCommand(storageUri)),
        vscode.commands.registerCommand(launchDashboardCommandName, launchDashboard),
        vscode.commands.registerCommand(getProxyUrlCommandName, getProxyUrl),
        vscode.commands.registerCommand(pickWorkflowIdCommandName, pickWorkflowId),
    ];

    return disposables;
}