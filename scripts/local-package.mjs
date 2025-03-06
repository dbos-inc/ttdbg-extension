import { execFileSync } from 'node:child_process';

const version = execFileSync('nbgv', ['get-version', '-v', 'SimpleVersion']).toString();
console.log(`Packaging version ${version}`);
execFileSync('npx', ['vsce', 'package', version, '--no-git-tag-version']);
