const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function runGit(args, options = {}) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeAssetName(name) {
  return String(name || '').trim().toLowerCase().replace(/[ .]+/g, '.');
}

function parseRemote() {
  const remoteUrl = runGit(['remote', 'get-url', 'origin']);
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (!match) {
    throw new Error(`Cannot parse GitHub remote URL: ${remoteUrl}`);
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function getGitHubToken() {
  const output = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const passwordLine = output.split(/\r?\n/).find((line) => line.startsWith('password='));
  if (!passwordLine) {
    throw new Error('No GitHub token available from git credential helper.');
  }

  return passwordLine.slice('password='.length);
}

function requestJson(method, url, token, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const request = https.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'openclaw-controller-release-uploader',
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': String(payload.length),
        } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const json = raw ? JSON.parse(raw) : null;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(json);
          return;
        }

        const details = Array.isArray(json?.errors)
          ? ` (${json.errors.map((entry) => entry.message || entry.code || JSON.stringify(entry)).join('; ')})`
          : '';
        const message = (json?.message || raw || `GitHub API request failed: ${response.statusCode}`) + details;
        const error = new Error(message);
        error.statusCode = response.statusCode;
        reject(error);
      });
    });

    request.on('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function uploadAsset(uploadUrl, assetPath, token) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(assetPath);
    const request = https.request(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'openclaw-controller-release-uploader',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const json = raw ? JSON.parse(raw) : null;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(json);
          return;
        }

        const details = Array.isArray(json?.errors)
          ? ` (${json.errors.map((entry) => entry.message || entry.code || JSON.stringify(entry)).join('; ')})`
          : '';
        const message = (json?.message || raw || `GitHub upload failed: ${response.statusCode}`) + details;
        reject(new Error(message));
      });
    });

    request.on('error', reject);
    fs.createReadStream(assetPath).on('error', reject).pipe(request);
  });
}

async function listReleaseAssets(apiBase, releaseId, token) {
  return requestJson('GET', `${apiBase}/releases/${releaseId}/assets?per_page=100`, token);
}

async function ensureRelease(apiBase, token, tag, body, targetCommitish) {
  try {
    return await requestJson('GET', `${apiBase}/releases/tags/${encodeURIComponent(tag)}`, token);
  } catch (error) {
    if (error.statusCode !== 404) {
      throw error;
    }

    return requestJson('POST', `${apiBase}/releases`, token, {
      tag_name: tag,
      target_commitish: targetCommitish,
      name: tag,
      draft: false,
      prerelease: false,
      generate_release_notes: false,
      body,
    });
  }
}

async function uploadReleaseAssets(options) {
  const tag = options.tag;
  const files = options.files.map((filePath) => path.resolve(repoRoot, filePath));
  const missingFiles = files.filter((filePath) => !fs.existsSync(filePath));
  if (missingFiles.length > 0) {
    throw new Error(`Asset file not found: ${missingFiles.join(', ')}`);
  }

  const { owner, repo } = parseRemote();
  const token = getGitHubToken();
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const targetCommitish = options.targetCommitish || runGit(['rev-parse', 'HEAD']);
  const release = await ensureRelease(apiBase, token, tag, options.body, targetCommitish);

  for (const filePath of files) {
    const assetName = path.basename(filePath);
    let existingAssets = await listReleaseAssets(apiBase, release.id, token);
    for (const asset of existingAssets || []) {
      if (normalizeAssetName(asset.name) === normalizeAssetName(assetName)) {
        await requestJson('DELETE', `${apiBase}/releases/assets/${asset.id}`, token);
        await delay(1500);
      }
    }

    const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(assetName)}`);
    await uploadAsset(uploadUrl, filePath, token);
    console.log(`UPLOADED_ASSET=${assetName}`);
  }

  const releaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${tag}`;
  console.log(`RELEASE_URL=${releaseUrl}`);
  return releaseUrl;
}

async function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const tag = process.argv[2] || `v${version}`;
  const files = process.argv.slice(3);
  const defaultFiles = [
    `release/OpenClaw Controller-${version}-win-x64.exe`,
    `release/OpenClaw Controller-${version}-win-x64.exe.blockmap`,
    'release/latest.yml',
  ];

  const releaseUrl = await uploadReleaseAssets({
    tag,
    files: files.length > 0 ? files : defaultFiles,
    body: `Release ${tag} for OpenClaw Controller.`,
  });
  console.log(`DONE=${releaseUrl}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  uploadReleaseAssets,
};