const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const path = require('path');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * @type {import('esbuild').Plugin}
 */
const anltr4OnResolvePlugin = {
	name: 'anltr4OnResolvePlugin',
	
	setup(build) {
		// force load of CJS version of ANTRL4
		build.onResolve({filter: /^antlr4$/}, args => {
			// Note, this logic assumes the esbuild script is in the root of the project
			const cjsPath = path.join(__dirname, 'node_modules/antlr4/dist/antlr4.node.cjs');
			return { path:  cjsPath };
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
			anltr4OnResolvePlugin,
		],
		external: [
			'better-sqlite3',
			'drizzle-orm/node-postgres',
			'mysql',
			'mysql2',
			'oracledb',
			'pg-native',
			'pg-query-stream',
			'source-map-support',
			'sqlite3',
			'tedious',
			'typeorm',
			'vscode',
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
