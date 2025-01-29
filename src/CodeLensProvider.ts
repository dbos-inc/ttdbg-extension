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

            const lenses = new Array<vscode.CodeLens>();
            for (const method of getWorkflowMethods(file)) {
                logger.info("provideCodeLenses", method);
                const start = document.positionAt(method.start);
                const end = document.positionAt(method.end);
                const range = new vscode.Range(start, end);
                const name = method.name;
                lenses.push(new vscode.CodeLens(range, {
                    title: 'Replay Debug',
                    tooltip: `Debug ${name} with the replay debugger`,
                    command: startDebuggingCodeLensCommandName,
                    arguments: [folder, { name, type: "Workflow", debug: "replay" }]
                }));
            }
            return lenses;
        } catch (e) {
            logger.error("provideCodeLenses", e);
        }
    }
}

export interface NamedImportInfo {
    name: string;
    alias: string;
    moduleName: string;
}

export interface DecoratorInfo {
    name: string;
    propertyName?: string;
}

export interface StaticMethodInfo {
    name: string;
    className: string | undefined;
    start: number;
    end: number;
    decorators: DecoratorInfo[];
}

export function* getImports(file: ts.SourceFile): Generator<NamedImportInfo, void, unknown> {
    for (const node of file.statements) {
        if (ts.isImportDeclaration(node)) {
            const moduleName = getName(node.moduleSpecifier);
            const bindings = node.importClause?.namedBindings;
            if (!bindings) { continue; }
            else if (ts.isNamedImports(bindings)) {
                for (const binding of bindings.elements) {
                    const name = binding.propertyName?.text ?? binding.name.text;
                    const alias = binding.name.text;
                    yield { name, alias, moduleName };
                }
            }
            else {
                throw Error(`Unsupported NamedImportBindings kind: ${ts.SyntaxKind[node.kind]}`);
            }
        }
    }
}


export function parseDecorator(node: ts.Decorator): DecoratorInfo | undefined {
    if (!ts.isCallExpression(node.expression)) { return; }
    const expr = node.expression.expression;
    if (ts.isIdentifier(expr)) {
        return { name: expr.text, propertyName: undefined };
    }
    if (ts.isPropertyAccessExpression(expr)) {
        return { name: getName(expr.expression), propertyName: expr.name.text };
    }
}

function isValid<T>(value: T | null | undefined): value is T { return !!value; }

export function* getStaticMethods(file: ts.SourceFile): Generator<StaticMethodInfo, void, unknown> {
    for (const node of file.statements) {
        if (ts.isClassDeclaration(node)) {
            const className = node.name?.text;
            for (const memberNode of node.members) {
                if (!ts.isMethodDeclaration(memberNode)) { continue; }

                const isStatic = (memberNode.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.StaticKeyword);
                if (!isStatic) { continue; }

                const decorators = (ts.getDecorators(memberNode) ?? [])
                    .map(parseDecorator)
                    .filter(isValid);
                yield {
                    name: getName(memberNode.name),
                    className,
                    start: memberNode.getStart(file),
                    end: memberNode.getEnd(),
                    decorators,
                };
            }
        }
    }
}

export function* getWorkflowMethods(file: ts.SourceFile) {
    const importMap = new Map<string, NamedImportInfo>();
    for (const imp of getImports(file)) {
        importMap.set(imp.alias, imp);
    }

    for (const method of getStaticMethods(file)) {
        for (const d of method.decorators) {
            const imp = importMap.get(d.name);
            if (!imp) { continue; }
            if (imp.moduleName !== '@dbos-inc/dbos-sdk') { continue; }
            if (imp.name === 'Workflow' && d.propertyName === undefined) {
                yield method;
            }
            else if (imp.name === 'DBOS' && d.propertyName === 'workflow') {
                yield method;
            }
        }
    }
}

function getName(node: ts.PropertyName | ts.Expression | ts.LeftHandSideExpression) {
    switch (true) {
        case ts.isCallExpression(node): return getName(node.expression);
        case ts.isIdentifier(node): return node.text;
        case ts.isStringLiteral(node): return node.text;
        default: throw Error(`Unsupported name kind: ${ts.SyntaxKind[node.kind]}`);
    }
}
