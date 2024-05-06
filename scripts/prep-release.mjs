import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * @param {string} versionJsonName
 */
function readVersionJson(versionJsonName) {
    const contents = fs.readFileSync(versionJsonName, 'utf-8');
    return JSON.parse(contents);
}

/**
 * @param {string} versionJsonName
 * @param {object} versionJson
 */
function writeVersionJson(versionJsonName, versionJson) {
    const contents = JSON.stringify(versionJson, null, 2);
    fs.writeFileSync(versionJsonName, contents);
}

/**
 * @param {string} repoName
 */
export function getVersion(repoName) {
    const versionJsonName = path.join(repoName, 'version.json');
    const versionJson = readVersionJson(versionJsonName);
    const version = versionJson.version;
    const regexVersion = /^(?<major>\d*)\.(?<minor>\d*)(-(?<prerel>.*))?$/;
    const match = regexVersion.exec(version);
    if (!match) { throw new Error(`Invalid version: '${version}'`); }
    return {
        major: +match.groups.major,
        minor: +match.groups.minor,
        prerel: match.groups.prerel
    };
}

/**
 * @param {string} repoName
 * @param {string} releaseVersion
 * @param {string} mainVersion
 */
export function prepareRelease(repoName, releaseVersion, mainVersion) {
    const versionJsonName = path.join(repoName, 'version.json');
    const releaseBranch = `release/v${releaseVersion}`;
    execFileSync('git', ['checkout', '-B', releaseBranch], { cwd: repoName });
    updateVersion(versionJsonName, releaseVersion);
    execFileSync('git', ['add', versionJsonName], { cwd: repoName });
    execFileSync('git', ['commit', '-m', `Set version to '${releaseVersion}'`], { cwd: repoName });
    execFileSync('git', ['checkout', 'main'], { cwd: repoName });
    updateVersion(versionJsonName, mainVersion);
    execFileSync('git', ['add', versionJsonName], { cwd: repoName });
    execFileSync('git', ['commit', '-m', `Set version to '${mainVersion}'`], { cwd: repoName });
    execFileSync('git', ['merge', releaseBranch, '-s', 'ours', '-m', `Merge branch '${releaseBranch}'`], { cwd: repoName });

    function updateVersion(versionJsonName, version) {
        const versionJson = readVersionJson(versionJsonName);
        versionJson.version = version;
        writeVersionJson(versionJsonName, versionJson);
    }
}

const dirName = path.dirname(fileURLToPath(import.meta.url));
const repoName = path.join(dirName, 'extension');

const { major, minor, prerel } = getVersion(repoName);
assert(minor % 2 === 1 && prerel === 'preview', 'Current version must have odd minor and preview prerelease tag');
console.log(`Current version: ${major}.${minor}-${prerel}`);

const releaseVersion = `${major}.${minor + 1}`;
const mainVersion = `${major}.${minor + 2}-preview`;
console.log("releaseVersion", releaseVersion);
console.log("mainVersion", mainVersion);

if (process.argv.includes('--run')) {
    prepareRelease(repoName, releaseVersion, mainVersion);
}