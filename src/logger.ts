import * as vscode from 'vscode';
import { stringify } from './utils';


// Logger class copied from https://github.com/microsoft/vscode-pull-request-github project
class Logger {
    private _outputChannel: vscode.LogOutputChannel;

    constructor() {
        this._outputChannel = vscode.window.createOutputChannel('DBOS Time Travel Debugger', { log: true });
    }

    dispose() {
        this._outputChannel.dispose();
    }

    private logString(message: any, component?: string): string {
        message = stringify(message);
        return component ? `${component}> ${message}` : message;
    }

    public trace(message: any, component: string) {
        this._outputChannel.trace(this.logString(message, component));
    }

    public debug(message: any, component: string) {
        this._outputChannel.debug(this.logString(message, component));
    }

    public info(message: any, component?: string) {
        this._outputChannel.info(this.logString(message, component));
    }

    public warn(message: any, component?: string) {
        this._outputChannel.warn(this.logString(message, component));
    }

    public error(message: any, component?: string) {
        const msg = this.logString(message, component);
        this._outputChannel.error(msg);
        console.error(msg);
    }
}

const logger = new Logger();
export default logger;
