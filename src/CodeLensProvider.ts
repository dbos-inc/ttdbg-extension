import * as vscode from 'vscode';
import ts from 'typescript';
import { startDebuggingCodeLensCommandName } from './commands';
import { logger } from './extension';

export type DbosMethodType = "Workflow" | "Transaction" | "Communicator";

export type DbosMethodInfo = { name: string; type: DbosMethodType };

export function getDbosWorkflowName(name: string, $type: DbosMethodType): string {
    switch ($type) {
        case "Workflow": return name;
        case "Transaction": return `temp_workflow-transaction-${name}`;
        case "Communicator": return `temp_workflow-external-${name}`;
        default: throw new Error(`Unsupported DbosMethodType: ${$type}`);
    }
}

export class CodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
        try {
            const folder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (!folder) { return; }

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
                        command: startDebuggingCodeLensCommandName,
                        arguments: [folder, { name: methodInfo.name, type: methodType }]
                    });
                })
                .filter(<T>(x?: T): x is T => !!x);
        } catch (e) {
            logger.error("provideCodeLenses", e);
        }
    }
}


interface ImportInfo {
    readonly name: string;
    readonly module: string;
};

interface MethodInfo {
    readonly node: ts.MethodDeclaration;
    readonly name: string;
    readonly decorators: readonly ImportInfo[];
}

function getDbosMethodType(decorators: readonly ImportInfo[]): DbosMethodType | undefined {
    for (const d of decorators) {
        if (d.module !== '@dbos-inc/dbos-sdk') { continue; }
        if (d.name === "Workflow") { return "Workflow"; }
        if (d.name === "Transaction") { return "Transaction"; }
        if (d.name === "Communicator") { return "Communicator"; }
    }
    return undefined;
}


function parse(file: ts.SourceFile): readonly MethodInfo[] {

    if (file.isDeclarationFile) { return []; }

    const importMap = new Map<string, ImportInfo>();
    for (const node of file.statements) {
        if (ts.isImportDeclaration(node)) {
            const moduleName = getName(node.moduleSpecifier);
            for (const bind of getBindings(node.importClause?.namedBindings)) {
                importMap.set(bind.name, { name: bind.propertyName ?? bind.name, module: moduleName });
            }
        }
    }

    const methods = new Array<MethodInfo>();
    for (const node of file.statements) {
        if (ts.isClassDeclaration(node)) {
            for (const mNode of node.members) {
                if (ts.isMethodDeclaration(mNode)) {
                    const isStatic = (mNode.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.StaticKeyword);
                    if (!isStatic) { continue; }
                    const mName = getName(mNode.name);
                    const decorators = new Array<ImportInfo>();
                    for (const dNode of ts.getDecorators(mNode) ?? []) {
                        const dName = importMap.get(getName(dNode.expression));
                        if (dName) { decorators.push(dName); }
                    }
                    methods.push({ node: mNode, name: mName, decorators });
                }
            }
        }
    }

    return methods;
}

function getName(node: ts.PropertyName | ts.Expression) {
    switch (true) {
        case ts.isCallExpression(node): return getName(node.expression);
        case ts.isIdentifier(node): return node.text;
        case ts.isStringLiteral(node): return node.text;
        default: throw Error(`Unsupported name kind: ${ts.SyntaxKind[node.kind]}`);
    }
}

function getBindings(node?: ts.NamedImportBindings) {
    if (!node) { return []; }
    switch (true) {
        case ts.isNamedImports(node):
            return node.elements.map(node => ({
                node,
                name: node.name.text,
                propertyName: node.propertyName?.text
            }));
        default:
            throw Error(`Unsupported NamedImportBindings kind: ${ts.SyntaxKind[node.kind]}`);
    }
}
