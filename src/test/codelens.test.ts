import * as assert from 'assert';
import ts from 'typescript';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { getImports, getStaticMethods, getWorkflowMethods, parseDecorator, StaticMethodInfo } from '../parsers/typeScript';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('getImports', () => {
		const code = `import { Workflow } from "@dbos-inc/dbos-sdk";
import { Workflow as TestWorkflow } from "@dbos-inc/dbos-sdk";`;
		const file = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest);
		const expected = [
			{ name: "Workflow", alias: "Workflow", moduleName: "@dbos-inc/dbos-sdk" },
			{ name: "Workflow", alias: "TestWorkflow", moduleName: "@dbos-inc/dbos-sdk" }
		];
		const actual = [...getImports(file)];
		assert.deepStrictEqual(actual, expected);
	});

	test('getStaticMethods', () => {
		const code = `
class Test1 {
	@Foo1()
	static test1() {}
	@Foo2()
	test2() {}
	@Foo3()
	static test3() {}
	@Foo4()
	test4() {}
}
	
class Test2 {
	@Foo.prop1()
	static test() {}
	@Foo.prop2()
	test2() {}
	@Foo.prop3()
	static test3() {}
	@Foo.prop4()
	test4() {}
}`;
		const file = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest);
		const expected = [
			{
				className: "Test1",
				name: "test1",
				decorators: [ { name: "Foo1", propertyName: undefined } ],
				start: 16,
				end: 42,
			},
			{
				className: 'Test1',
				name: 'test3',
				decorators: [ { name: "Foo3", propertyName: undefined } ],
				start: 65,
				end: 91,
			},
			{
				className: 'Test2',
				name: 'test',
				decorators: [{ name: "Foo", propertyName: "prop1" }],
				start: 132,
				end: 162,
			},
			{
				className: 'Test2',
				name: 'test3',
				decorators: [{ name: "Foo", propertyName: "prop3" }],
				start: 190,
				end: 221,
			},
		];
		const actual = [...getStaticMethods(file)];
		assert.deepStrictEqual(actual, expected);
	});

	test("parseDecorator-identifier", () => {
		const code = `class Test {
			@Test()
			static test() {}
		}`;
		const file = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest);
		const classNode = file.statements[0] as ts.ClassDeclaration;
		const methodNode = classNode.members[0] as ts.MethodDeclaration;
		const decoratorNodes = ts.getDecorators(methodNode) ?? [];
		const actual = parseDecorator(decoratorNodes[0]);
		const expected = { name: "Test", propertyName: undefined };
		assert.deepEqual(actual, expected);
	});

	test("parseDecorator-property", () => {
		const code = `class Test {
			@Test.prop()
			static test() {}
		}`;
		const file = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest);
		const classNode = file.statements[0] as ts.ClassDeclaration;
		const methodNode = classNode.members[0] as ts.MethodDeclaration;
		const decoratorNodes = ts.getDecorators(methodNode) ?? [];
		const actual = parseDecorator(decoratorNodes[0]);
		const expected = { name: "Test", propertyName: "prop" };
		assert.deepEqual(actual, expected);
	});

	test("getWorkflowMethods-v1", () => {
		const code = `
		import { Workflow } from "@dbos-inc/dbos-sdk";

		class Test {
			@Workflow()
			static test() {}

			static test2() {}
		}`;
		const file = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest);
		const actual = [...getWorkflowMethods(file)];
		const expected: Array<StaticMethodInfo> = [
			{
				className: "Test",
				name: "test",
				decorators: [{ name: "Workflow", propertyName: undefined }],
				start: 69,
				end: 100,
			}
		];
		assert.deepEqual(actual, expected);

	});

	test("getWorkflowMethods-v1-alias", () => {
		const code = `
		import { Workflow as TestWorkflow } from "@dbos-inc/dbos-sdk";

		class Test {
			@TestWorkflow()
			static test() {}

			static test2() {}
		}`;
		const file = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest);
		const actual = [...getWorkflowMethods(file)];
		const expected: Array<StaticMethodInfo> = [
			{
				className: "Test",
				name: "test",
				decorators: [{ name: "TestWorkflow", propertyName: undefined }],
				start: 85,
				end: 120,
			}
		];
		assert.deepEqual(actual, expected);

	});

	test("getWorkflowMethods-v2", () => {
		const code = `
		import { DBOS } from "@dbos-inc/dbos-sdk";

		class Test {
			@DBOS.workflow()
			static test() {}

			static test2() {}
		}`;
		const file = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest);
		const actual = [...getWorkflowMethods(file)];
		const expected: Array<StaticMethodInfo> = [
			{
				className: "Test",
				name: "test",
				decorators: [{ name: "DBOS", propertyName: "workflow" }],
				start: 65,
				end: 101,
			}
		];
		assert.deepEqual(actual, expected);

	});

	test("getWorkflowMethods-v2-alias", () => {
		const code = `
		import { DBOS as TestDBOS } from "@dbos-inc/dbos-sdk";

		class Test {
			@TestDBOS.workflow()
			static test() {}

			static test2() {}
		}`;
		const file = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest);
		const actual = [...getWorkflowMethods(file)];
		const expected: Array<StaticMethodInfo> = [
			{
				className: "Test",
				name: "test",
				decorators: [{ name: "TestDBOS", propertyName: "workflow" }],
				start: 77,
				end: 117,
			}
		];
		assert.deepEqual(actual, expected);

	});

});


