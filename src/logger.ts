import * as vscode from 'vscode';
import winston from 'winston';
import Transport from "winston-transport";
import { LEVEL, MESSAGE, SPLAT } from "triple-beam";

export class LogOutputChannelTransport extends Transport {
    private outChannel: vscode.LogOutputChannel;

    constructor(name: string, opts?: Transport.TransportStreamOptions) {
        // VSCode provides UI to control which log levels are shown.
        // At the transport layer, log everything and let VSCode filter.
        super({ ...opts, level: 'trace' });
        this.outChannel = vscode.window.createOutputChannel(name, { log: true });
    }

    close() { this.outChannel.dispose(); }

    log(info: winston.Logform.TransformableInfo, next: () => void) {
        setImmediate(() => { this.emit('logged', info); });

        const { level, message, [LEVEL]: $level, [MESSAGE]: $message, [SPLAT]: $splat, ...properties } = info;
        switch ($level ?? level) {
            case "error": this.outChannel.error(message, properties); break;
            case "warn": this.outChannel.warn(message, properties); break;
            case "info": this.outChannel.info(message, properties); break;
            case "debug": this.outChannel.debug(message, properties); break;
            case "trace": this.outChannel.trace(message, properties); break;
            default:
                vscode.window.showErrorMessage(`Unknown log level: ${info[LEVEL]}`);
        }

        next();
    }
}

export interface Logger {
    log: winston.LogMethod;
    error: winston.LeveledLogMethod;
    warn: winston.LeveledLogMethod;
    info: winston.LeveledLogMethod;
    debug: winston.LeveledLogMethod;
    trace: winston.LeveledLogMethod;
    close(): void;
}

export function createLogger(...transports: winston.transport[]) {
    // Using custom Winston logging levels to match VSCode's Log Levels 
    // https://github.com/winstonjs/winston?tab=readme-ov-file#using-custom-logging-levels
    const logger = winston.createLogger({
        levels: {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3,
            trace: 4
        },
        transports
    });
    return logger as unknown as Logger;
}
