import * as assert from 'assert';
import ts from 'typescript';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { getImports, getStaticMethods, parseDecorator } from '../CodeLensProvider';
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
		assert.deepEqual(expected, actual);
	})

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
		assert.deepEqual(expected, actual);
	})

	// test("parseMethod", () => {
	// 	const code = `class TestClass {
	// 		@TestDecorator.prop()
	// 		static testMethod() {}
	// 	}`;
	// 	const file = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest);
	// 	const classNode = file.statements[0] as ts.ClassDeclaration;
	// 	const methodNode = classNode.members[0] as ts.MethodDeclaration;
	// 	const actual = parseMethod(methodNode);
	// 	const expected = { 
	// 		name: "testMethod", 
	// 		decorators: [{ name: "TestDecorator", propertyName: "prop" }]
	// 	};
	// 	assert.deepEqual(expected, actual);
	// })
});


