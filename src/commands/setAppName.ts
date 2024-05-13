import * as vscode from 'vscode';
import { config } from '../extension';

export async function setApplicationName() {

    const currentAppName = config.getAppName();

    const deleteCurrentNameButton = { iconPath: new vscode.ThemeIcon("trash"), tooltip: "Clear app name"};

    const inputBox = vscode.window.createInputBox();
    inputBox.title = "Set DBOS Cloud app name";
    inputBox.prompt = "Enter custom package name. Leave blank to use name from package.json";
    inputBox.value = currentAppName ?? "";
    inputBox.buttons = currentAppName ? [deleteCurrentNameButton] : [];
    inputBox.onDidAccept(async () => {
        if (inputBox.validationMessage) { return; }
        if (inputBox.value === currentAppName) { return; }
        if (inputBox.value === "") { return; }
        await config.setAppName(inputBox.value);
        inputBox.hide();
    });
    inputBox.onDidTriggerButton(async (btn) => {
        if (btn === deleteCurrentNameButton) {
            await config.setAppName(undefined);
        }
        inputBox.hide();
    });
    inputBox.onDidChangeValue(value => {
        const regex = /^[a-z0-9-~][a-z0-9-._~]*$/;
        inputBox.validationMessage = regex.test(value) ? "" : "Invalid app name";
    });
    inputBox.show();
}