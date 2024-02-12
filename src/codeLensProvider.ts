import * as vscode from 'vscode';
import ts from 'typescript';
import { getDbosMethodType, parse } from './sourceParser';
import { logger } from './extension';
import { startDebuggingCommandName } from './DebugProxy';

export class TTDbgCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
        try {
            const text = document.getText();
            const file = ts.createSourceFile(
                document.fileName,
                text,
                ts.ScriptTarget.Latest
            );

            return parse(file)
                .map(methodInfo => {
                    const methodType = getDbosMethodType(methodInfo.decorators);
                    if (!methodType) { return undefined; }

                    const start = methodInfo.node.getStart(file);
                    const end = methodInfo.node.getEnd();
                    const range = new vscode.Range(
                        document.positionAt(start),
                        document.positionAt(end)
                    );

                    return new vscode.CodeLens(range, {
                        title: '⏳ Time Travel Debug',
                        tooltip: `Debug ${methodInfo.name} with the DBOS Time Travel Debugger`,
                        command: startDebuggingCommandName,
                        arguments: [methodInfo.name, methodType]
                    });
                })
                .filter(<T>(x?: T): x is T => !!x);
        } catch (e) {
            logger.error(e);
        }
    }
}

