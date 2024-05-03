import * as vscode from 'vscode';
import type { CloudStorage } from '../CloudStorage';
import { getCloudLoginCommand } from './cloudLogin';
import { deleteAppDatabasePassword } from './deleteAppDatabasePassword';
import { getDeleteDomainCredentialsCommand, } from './deleteDomainCredentials';
import { deleteStoredPasswords } from './deleteStoredPasswords';
import { getProxyUrl } from './getProxyUrl';
import { launchDashboard } from './launchDashboard';
import { getLaunchDebugProxyCommand } from './launchDebugProxy';
import { pickWorkflowId } from './pickWorkflowId';

import { shutdownDebugProxy } from './shutdownDebugProxy';
import { startDebuggingFromCodeLens } from './startDebuggingFromCodeLens';
import { startDebuggingFromUri } from './startDebuggingFromUri';
import { getUpdateDebugProxyCommand } from './updateDebugProxy';
import { getRefreshDomainCommand } from './refreshDomain';

export const cloudLoginCommandName = "dbos-ttdbg.cloud-login";
export const deleteAppDatabasePasswordCommandName = "dbos-ttdbg.delete-app-db-password";
export const deleteDomainCredentialsCommandName = "dbos-ttdbg.delete-domain-credentials";
export const deleteStoredPasswordsCommandName = "dbos-ttdbg.delete-stored-passwords";
export const getProxyUrlCommandName = "dbos-ttdbg.get-proxy-url";
export const launchDashboardCommandName = "dbos-ttdbg.launch-dashboard";
export const launchDebugProxyCommandName = "dbos-ttdbg.launch-debug-proxy";
export const pickWorkflowIdCommandName = "dbos-ttdbg.pick-workflow-id";
export const refreshDomainCommandName = "dbos-ttdbg.refresh-domain";
export const shutdownDebugProxyCommandName = "dbos-ttdbg.shutdown-debug-proxy";
export const startDebuggingCodeLensCommandName = "dbos-ttdbg.start-debugging-code-lens";
export const startDebuggingUriCommandName = "dbos-ttdbg.start-debugging-uri";
export const updateDebugProxyCommandName = "dbos-ttdbg.update-debug-proxy";

export function registerCommands(cloudStorage: CloudStorage, storageUri: vscode.Uri, refresh: (domain: string) => Promise<void>) {
    const disposables = [
        vscode.commands.registerCommand(cloudLoginCommandName, getCloudLoginCommand(refresh)),
        vscode.commands.registerCommand(deleteAppDatabasePasswordCommandName, deleteAppDatabasePassword),
        vscode.commands.registerCommand(deleteDomainCredentialsCommandName, getDeleteDomainCredentialsCommand(refresh)),
        vscode.commands.registerCommand(deleteStoredPasswordsCommandName, deleteStoredPasswords),
        vscode.commands.registerCommand(getProxyUrlCommandName, getProxyUrl),
        vscode.commands.registerCommand(launchDashboardCommandName, launchDashboard),
        vscode.commands.registerCommand(launchDebugProxyCommandName, getLaunchDebugProxyCommand(storageUri)),
        vscode.commands.registerCommand(pickWorkflowIdCommandName, pickWorkflowId),
        vscode.commands.registerCommand(refreshDomainCommandName, getRefreshDomainCommand(refresh)),
        vscode.commands.registerCommand(shutdownDebugProxyCommandName, shutdownDebugProxy),
        vscode.commands.registerCommand(startDebuggingCodeLensCommandName, startDebuggingFromCodeLens),
        vscode.commands.registerCommand(startDebuggingUriCommandName, startDebuggingFromUri),
        vscode.commands.registerCommand(updateDebugProxyCommandName, getUpdateDebugProxyCommand(cloudStorage, storageUri)),
    ];

    return disposables;
}