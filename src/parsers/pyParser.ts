import * as vscode from 'vscode';
import type { DbosWorkflowMethod } from '../CodeLensProvider';
import { CharStream, CommonTokenStream, ParseTreeWalker } from 'antlr4';
import Python3Lexer from './python/Python3Lexer';
import Python3Parser, { DecoratedContext, Import_fromContext, Import_nameContext } from './python/Python3Parser';
import Python3ParserListener from './python/Python3ParserListener';

type AliasedName = {
    name: readonly string[];
    asName?: string;
};

type FromImport = {
    module: readonly string[];
    types: readonly AliasedName[];
}

type DecoratedFunction = {
    name: string;
    decorators: string[][];
    start: number;
    stop: number;
}

class DbosPythonListener extends Python3ParserListener {

    readonly nameImports = new Array<AliasedName>();
    readonly fromImports = new Array<FromImport>();
    readonly decoratedFunctions = new Array<DecoratedFunction>();

    enterImport_name = (ctx: Import_nameContext) => {
        const dansCtx = ctx.dotted_as_names();
        for (const danCtx of dansCtx.dotted_as_name_list()) {
            const name = danCtx.dotted_name().name_list().map(n => n.getText());
            const asName = danCtx.name()?.getText();
            this.nameImports.push({ name, asName });
        }
    };

    enterImport_from = (ctx: Import_fromContext) => {
        const module = ctx.dotted_name().name_list().map(n => n.getText());
        const names = ctx.import_as_names().import_as_name_list().map(n => {
            const name = n.name_list()[0].getText();
            const asName = n.AS() ? n.name_list()[1].getText() : undefined;
            return { name: [name], asName } as AliasedName;
        });
        this.fromImports.push({ module, types: names });
    };

    enterDecorated = (ctx: DecoratedContext) => {
        const funcDef = ctx.funcdef() ?? ctx.async_funcdef().funcdef();
        if (!funcDef) { return; }
        const start = ctx.start.start;
        const stop = ctx.stop?.stop ?? ctx.start.stop;
        const decorators = ctx.decorators().decorator_list().map(c => c.dotted_name().name_list().map(n => n.getText()));
        const name = funcDef.name().getText();
        this.decoratedFunctions.push({
            decorators,
            name,
            start,
            stop,
        });
    };

    *getWorkflowMethods() {
        const dbosModules = new Set<string>();
        for (const { name, asName } of this.nameImports) {
            if (name.length === 1 && name[0] === 'dbos') {
                dbosModules.add(asName ?? name[0]);
            }
        }

        const dbosTypes = new Set<string>();
        for (const { module, types } of this.fromImports) {
            if (module.length === 1 && module[0] === 'dbos') {
                for (const { name, asName } of types) {
                    if (name.length === 1 && name[0] === 'DBOS') {
                        dbosTypes.add(asName ?? name[0]);
                    }
                }
            }
        }

        for (const func of this.decoratedFunctions) {
            if (isDbosWorkflow(func, dbosModules, dbosTypes)) {
                yield func;
            }
        }

        function isDbosWorkflow(func: DecoratedFunction, dbosModules: Set<string>, dbosTypes: Set<string>) {
            for (const dec of func.decorators) {
                if (dec.length === 3 && dbosModules.has(dec[0]) && dec[1] === "DBOS" && dec[2] === "workflow") {
                    return true;
                }
                if (dec.length === 2 && dbosTypes.has(dec[0]) && dec[1] === "workflow") {
                    return true;
                }
            }
            return false;
        }
    }
}

export function* parsePython(document: vscode.TextDocument, token: vscode.CancellationToken): Generator<DbosWorkflowMethod, void, unknown> {
    const input = document.getText();
    const lexer = new Python3Lexer(new CharStream(input));
    const parser = new Python3Parser(new CommonTokenStream(lexer));
    const tree = parser.file_input();

    const listener = new DbosPythonListener();
    ParseTreeWalker.DEFAULT.walk(listener, tree);

    for (const func of listener.getWorkflowMethods()) {
        if (token.isCancellationRequested) { break; }
        yield { 
            name: func.name, 
            start: document.positionAt(func.start),
            end: document.positionAt(func.stop),
        };
    }
}