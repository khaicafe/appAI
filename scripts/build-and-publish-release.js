const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { uploadReleaseAssets } = require('./upload-release-asset');

const repoRoot = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  });
}

function runGit(args, options = {}) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function tryRunGit(args, options = {}) {
  try {
    return runGit(args, options);
  } catch {
    return '';
  }
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

function ensureTag(tag) {
  const head = runGit(['rev-parse', 'HEAD']);
  const localTagCommit = tryRunGit(['rev-list', '-n', '1', tag], { stdio: ['pipe', 'pipe', 'ignore'] });
  if (localTagCommit && localTagCommit !== head) {
    throw new Error(`Tag ${tag} already exists on ${localTagCommit}, not current HEAD ${head}.`);
  }

  const remoteTagOutput = runGit(['ls-remote', '--tags', 'origin', tag]);
  const remoteTagCommit = remoteTagOutput ? remoteTagOutput.split(/\s+/)[0] : '';
  if (remoteTagCommit && remoteTagCommit !== head) {
    throw new Error(`Remote tag ${tag} already exists on ${remoteTagCommit}, not current HEAD ${head}.`);
  }

  if (!localTagCommit) {
    run('git', ['tag', tag]);
  }

  if (!remoteTagCommit) {
    run('git', ['push', 'origin', tag]);
  }
}

function getVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  return packageJson.version;
}

function getReleaseFiles(version) {
  return [
    `release/OpenClaw Controller-${version}-win-x64.exe`,
    `release/OpenClaw Controller-${version}-win-x64.exe.blockmap`,
    'release/latest.yml',
  ];
}

async function main() {
  const signed = hasArg('--signed');
  const skipBuild = hasArg('--skip-build');
  const version = getVersion();
  const tag = `v${version}`;
  const buildScript = signed ? 'dist:win:signed' : 'dist:win';

  if (!skipBuild) {
    console.log(`BUILD_SCRIPT=${buildScript}`);
    run(getNpmCommand(), ['run', buildScript]);
  }

  ensureTag(tag);

  const releaseUrl = await uploadReleaseAssets({
    tag,
    files: getReleaseFiles(version),
    body: `Release ${tag} for OpenClaw Controller.`,
    targetCommitish: runGit(['rev-parse', 'HEAD']),
  });

  console.log(`PUBLISHED_RELEASE=${releaseUrl}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});