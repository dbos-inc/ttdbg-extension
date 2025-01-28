import * as assert from 'assert';
import ts from 'typescript';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { getImports } from '../CodeLensProvider';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	// test('Sample test', () => {
	// 	assert.strictEqual(-1, [1, 2, 3].indexOf(5));
	// 	assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	// });

	test('getImports', () => {
		const code = `import { Workflow } from "@dbos-inc/dbos-sdk";
import { Workflow as TestWorkflow } from "@dbos-inc/dbos-sdk";`;
		const file = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest);
		const expected = [
			{ name: "Workflow", propertyName: undefined, moduleName: "@dbos-inc/dbos-sdk" },
			{ name: "TestWorkflow", propertyName: "Workflow", moduleName: "@dbos-inc/dbos-sdk" }
		]
		const actual = [...getImports(file)];
		assert.deepStrictEqual(expected, actual);		
	})
});


