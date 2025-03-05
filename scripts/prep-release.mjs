import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} versionJsonName
 * @returns {object}
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
 * @param {number} major
 * @param {number} minor
 */
function getNewVersion(major, minor) {
    const releaseVersionArgIndex = process.argv.indexOf('--relver');
    if (releaseVersionArgIndex !== -1) {
        const version = process.argv[releaseVersionArgIndex + 1];
        if (!version) { throw new Error(`No release version specified`); }

        const regexVersion = /^(?<major>\d*)\.(?<minor>\d*)$/;
        const match = regexVersion.exec(version);
        if (!match) { throw new Error(`Invalid version: '${version}'`); }

        major = +match.groups.major;
        minor = +match.groups.minor;
        if (minor % 2 !== 0) { throw new Error('Release must have an even minor version'); }

        const releaseVersion = `${major}.${minor}`;
        const mainVersion = `${major}.${minor + 1}-preview`;
        return { mainVersion, releaseVersion };
    } else {
        const releaseVersion = `${major}.${minor + 1}`;
        const mainVersion = `${major}.${minor + 2}-preview`;
        return { mainVersion, releaseVersion };
    }
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


function main() {
    const dirName = path.dirname(fileURLToPath(import.meta.url));
    const repoName = path.join(dirName, '..');

    const { major, minor, prerel } = getVersion(repoName);
    if (minor % 2 !== 1 || prerel !== "preview") { throw new Error('Current must have odd minor version and preview prerelease tag'); }

    const { mainVersion, releaseVersion } = getNewVersion(major, minor);
    console.log(`Current version: ${major}.${minor}-${prerel}`);
    console.log("release branch Version", releaseVersion);
    console.log("New main branch Version", mainVersion);

    if (process.argv.includes('--run')) {
        prepareRelease(repoName, releaseVersion, mainVersion);
    }
}

try {
    main();
} catch (e) {
    console.error(e.message);
    process.exit(1);
}