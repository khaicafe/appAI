const os = require('node:os');
const path = require('node:path');
const { spawn } = require('child_process');
const fs = require('fs');
const { getSavedKeys, saveKeys } = require('./key-store');

const OPENCLAW_GEMINI_FLASH_MODEL = 'google/gemini-2.5-flash';
const OPENCLAW_GOOGLE_PROFILE_ID = 'google:default';
const OPENCLAW_OPENROUTER_MODEL = 'openrouter/qwen/qwen3.6-plus:free';
const OPENCLAW_OPENROUTER_PROFILE_ID = 'openrouter:default';
const TELEGRAM_MEDIA_MAX_MB = 100;

const GEMINI_MODEL_ENTRIES = {
  'google/gemini-flash-latest': { alias: 'Gemini Flash Latest' },
  'google/gemini-2.5-flash': { alias: 'Gemini 2.5 Flash' },
  'google/gemini-2.5-pro': { alias: 'Gemini 2.5 Pro' },
  'google/gemini-2.0-flash': { alias: 'Gemini 2.0 Flash' },
};

const PROVIDER_CONFIG = {
  gemini: {
    label: 'Gemini',
    model: OPENCLAW_GEMINI_FLASH_MODEL,
    fallbackModels: [OPENCLAW_GEMINI_FLASH_MODEL, 'google/gemini-flash-latest', 'gemini-flash-latest'],
    profileId: OPENCLAW_GOOGLE_PROFILE_ID,
    provider: 'google',
    pluginKey: 'google',
    modelEntries: GEMINI_MODEL_ENTRIES,
  },
  openrouter: {
    label: 'OpenRouter',
    model: OPENCLAW_OPENROUTER_MODEL,
    fallbackModels: [OPENCLAW_OPENROUTER_MODEL],
    profileId: OPENCLAW_OPENROUTER_PROFILE_ID,
    provider: 'openrouter',
    pluginKey: null,
    modelEntries: {
      'openrouter/auto': { alias: 'OpenRouter' },
      [OPENCLAW_OPENROUTER_MODEL]: { alias: 'OpenRouter Free' },
    },
  },
};

function sendMessage(payload) {
  if (typeof process.send === 'function') {
    process.send(payload);
  }
}

function sendLog(message) {
  sendMessage({ type: 'log', message });
}

function sendResult(result) {
  sendMessage({ type: 'result', result });
}

function sendError(error) {
  sendMessage({
    type: 'error',
    error: {
      message: error?.message || String(error),
      stack: error?.stack || null,
    },
  });
}

function escapePowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function getHomeDir() {
  return process.env.USERPROFILE || os.homedir();
}

function getOpenClawConfigPath() {
  return path.join(getHomeDir(), '.openclaw', 'openclaw.json');
}

function getDefaultOpenClawWorkspacePath() {
  return path.join(getHomeDir(), '.openclaw', 'workspace');
}

function getOpenClawAgentAuthProfilesPath() {
  return path.join(getHomeDir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
}

function getOpenClawCredentialsPath() {
  return path.join(getHomeDir(), '.openclaw', 'credentials');
}

function getBundledSkillsPath() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'skills') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'skills') : null,
    path.join(__dirname, 'skills'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Khong tim thay thu muc skills de copy. Da thu cac path: ${candidates.join(', ')}`);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getConfiguredOpenClawWorkspacePath() {
  const configPath = getOpenClawConfigPath();
  if (!fs.existsSync(configPath)) {
    return getDefaultOpenClawWorkspacePath();
  }

  try {
    const config = readJsonFile(configPath);
    const workspacePath = config?.agents?.defaults?.workspace;
    if (typeof workspacePath === 'string' && workspacePath.trim()) {
      return workspacePath.trim();
    }
  } catch (_error) {
    // Fall back to the default workspace path below.
  }

  return getDefaultOpenClawWorkspacePath();
}

function copyBundledSkillsToWorkspace() {
  const sourcePath = getBundledSkillsPath();
  const workspacePath = getConfiguredOpenClawWorkspacePath();
  const destinationPath = path.join(workspacePath, 'skills');

  fs.mkdirSync(workspacePath, { recursive: true });
  fs.cpSync(sourcePath, destinationPath, {
    recursive: true,
    force: true,
  });

  const copiedEntries = fs.readdirSync(sourcePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return {
    sourcePath,
    workspacePath,
    destinationPath,
    copiedEntries,
  };
}

function normalizeProvider(provider) {
  return provider === 'gemini' || provider === 'openrouter' ? provider : null;
}

function resolveInstallProvider(params = {}) {
  const explicitProvider = normalizeProvider(params.provider);
  if (explicitProvider) {
    return explicitProvider;
  }

  const openrouterApiKey = String(params.openrouterApiKey || '').trim();
  const geminiApiKey = String(params.geminiApiKey || '').trim();

  if (openrouterApiKey) {
    return 'openrouter';
  }

  if (geminiApiKey) {
    return 'gemini';
  }

  return null;
}

async function resolveEffectiveKeyParams(params = {}) {
  const savedKeys = await getSavedKeys().catch(() => ({}));
  const openrouterApiKey = String(params?.openrouterApiKey || savedKeys?.openrouterApiKey || '').trim();
  const geminiApiKey = String(params?.geminiApiKey || savedKeys?.geminiApiKey || '').trim();
  const telegramBotToken = String(params?.telegramBotToken || savedKeys?.telegramBotToken || '').trim();

  return {
    provider: resolveInstallProvider({
      provider: params?.provider,
      openrouterApiKey,
      geminiApiKey,
    }),
    openrouterApiKey,
    geminiApiKey,
    telegramBotToken,
  };
}

function detectProviderFromConfig(config) {
  const primaryModel = config?.agents?.defaults?.model?.primary || '';
  if (typeof primaryModel === 'string') {
    if (primaryModel.startsWith('openrouter/')) {
      return 'openrouter';
    }
    if (primaryModel.startsWith('google/') || primaryModel.startsWith('gemini')) {
      return 'gemini';
    }
  }

  if (config?.auth?.profiles?.[OPENCLAW_OPENROUTER_PROFILE_ID]) {
    return 'openrouter';
  }

  if (config?.auth?.profiles?.[OPENCLAW_GOOGLE_PROFILE_ID]) {
    return 'gemini';
  }

  return null;
}

function getStoredApiKey(provider) {
  const providerConfig = PROVIDER_CONFIG[provider];
  if (!providerConfig) {
    return null;
  }

  const authProfilesPath = getOpenClawAgentAuthProfilesPath();
  if (!fs.existsSync(authProfilesPath)) {
    return null;
  }

  try {
    const authProfiles = readJsonFile(authProfilesPath);
    const storedKey = authProfiles?.profiles?.[providerConfig.profileId]?.key;
    return typeof storedKey === 'string' && storedKey.trim() ? storedKey.trim() : null;
  } catch (_error) {
    return null;
  }
}

function getSavedApiKeyForProvider(savedKeys, provider) {
  if (!savedKeys || typeof savedKeys !== 'object') {
    return null;
  }

  const keyName = provider === 'openrouter' ? 'openrouterApiKey' : 'geminiApiKey';
  const apiKey = savedKeys[keyName];
  return typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
}

function hasProviderSignal(provider, options = {}, existingConfig = null, savedKeys = null) {
  const requestedApiKey = provider === 'openrouter'
    ? String(options.openrouterApiKey || '').trim()
    : String(options.geminiApiKey || '').trim();

  if (requestedApiKey) {
    return true;
  }

  if (getStoredApiKey(provider)) {
    return true;
  }

  if (getSavedApiKeyForProvider(savedKeys, provider)) {
    return true;
  }

  return Boolean(existingConfig?.auth?.profiles?.[PROVIDER_CONFIG[provider].profileId]);
}

async function getDesiredProviderState(options = {}, existingConfig = null) {
  const savedKeys = await getSavedKeys().catch(() => null);
  const explicitProvider = normalizeProvider(options.provider);
  const detectedProvider = detectProviderFromConfig(existingConfig || {});
  const hasOpenRouter = hasProviderSignal('openrouter', options, existingConfig, savedKeys);
  const hasGemini = hasProviderSignal('gemini', options, existingConfig, savedKeys);

  if (hasOpenRouter) {
    return {
      primaryProvider: 'openrouter',
      authProviders: hasGemini ? ['gemini', 'openrouter'] : ['openrouter'],
      modelProviders: ['gemini', 'openrouter'],
      savedKeys,
    };
  }

  if (hasGemini) {
    return {
      primaryProvider: 'gemini',
      authProviders: ['gemini'],
      modelProviders: ['gemini'],
      savedKeys,
    };
  }

  const fallbackProvider = explicitProvider || detectedProvider || null;
  return {
    primaryProvider: fallbackProvider,
    authProviders: fallbackProvider ? [fallbackProvider] : [],
    modelProviders: fallbackProvider ? [fallbackProvider] : [],
    savedKeys,
  };
}

function buildBaseOpenClawConfig(primaryProvider) {
  const providerConfig = PROVIDER_CONFIG[primaryProvider] || PROVIDER_CONFIG.openrouter;

  return {
    agents: {
      defaults: {
        model: {
          primary: providerConfig.model,
        },
        models: {
          ...providerConfig.modelEntries,
        },
      },
    },
    gateway: {
      mode: 'local',
    },
    tools: {
      exec: {
        ask: 'off',
        security: 'full',
      },
      profile: 'full',
    },
    auth: {
      profiles: {},
    },
    plugins: {
      entries: {},
    },
    channels: {
      telegram: {
        enabled: false,
        actions: {
          sendMessage: true,
        },
        mediaMaxMb: TELEGRAM_MEDIA_MAX_MB,
      },
    },
  };
}

function getStoredTelegramBotToken() {
  const configPath = getOpenClawConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const config = readJsonFile(configPath);
    const token = config?.channels?.telegram?.botToken;
    return typeof token === 'string' && token.trim() ? token.trim() : null;
  } catch (_error) {
    return null;
  }
}

async function getTelegramBotTokenFromStore() {
  try {
    const savedKeys = await getSavedKeys();
    const token = typeof savedKeys?.telegramBotToken === 'string' ? savedKeys.telegramBotToken.trim() : '';
    if (token) {
      return token;
    }
  } catch (_error) {
    // Fall through to config-based lookup.
  }

  return getStoredTelegramBotToken();
}


async function reconcileOpenClawConfigState(options = {}) {
  const configPath = getOpenClawConfigPath();
  const authProfilesPath = getOpenClawAgentAuthProfilesPath();
  const result = {
    configPath,
    authProfilesPath,
    modelChanged: false,
    authChanged: false,
    toolsChanged: false,
    provider: null,
  };

  const requestedTelegramBotToken = String(options.telegramBotToken || '').trim();
  const existingConfig = fs.existsSync(configPath) ? readJsonFile(configPath) : null;
  const providerState = await getDesiredProviderState(options, existingConfig || {});
  const activeProviders = providerState.authProviders;
  const primaryProvider = providerState.primaryProvider;

  if (!primaryProvider) {
    return result;
  }

  const config = existingConfig || buildBaseOpenClawConfig(primaryProvider);
  const providerConfig = PROVIDER_CONFIG[primaryProvider];
  const currentDefaults = config.agents?.defaults || {};
  const currentPrimaryModel = currentDefaults.model?.primary || null;
  const currentModels = currentDefaults.models || {};
  const mergedModelEntries = providerState.modelProviders.reduce((entries, providerName) => {
    return {
      ...entries,
      ...PROVIDER_CONFIG[providerName].modelEntries,
    };
  }, {});
  const missingModelEntries = Object.entries(mergedModelEntries).some(([modelName, modelConfig]) => {
    if (!Object.prototype.hasOwnProperty.call(currentModels, modelName)) {
      return true;
    }

    const currentEntry = currentModels[modelName] || {};
    return Object.entries(modelConfig).some(([key, value]) => currentEntry[key] !== value);
  });
  const currentProviderPluginEnabled = providerConfig.pluginKey
    ? config.plugins?.entries?.[providerConfig.pluginKey]?.enabled === true
    : true;
  const currentToolsProfile = config.tools?.profile;
  const currentToolsExecAsk = config.tools?.exec?.ask;
  const currentToolsExecSecurity = config.tools?.exec?.security;
  const currentTelegramEnabled = config.channels?.telegram?.enabled === true;
  const currentTelegramBotToken = typeof config.channels?.telegram?.botToken === 'string'
    ? config.channels.telegram.botToken
    : null;
  const currentTelegramSendMessage = config.channels?.telegram?.actions?.sendMessage === true;
  const currentTelegramMediaMaxMb = config.channels?.telegram?.mediaMaxMb;
  const telegramBotToken = requestedTelegramBotToken || getStoredTelegramBotToken();

  config.agents = config.agents || {};
  config.agents.defaults = {
    ...currentDefaults,
    model: {
      ...(currentDefaults.model || {}),
      primary: providerConfig.model,
    },
    models: {
      ...currentModels,
      ...mergedModelEntries,
    },
  };

  if (activeProviders.includes('gemini')) {
    config.plugins = config.plugins || {};
    config.plugins.entries = config.plugins.entries || {};
    config.plugins.entries.google = {
      ...(config.plugins.entries.google || {}),
      enabled: true,
    };
  }

  config.tools = config.tools || {};
  config.tools.profile = 'full';
  config.tools.exec = {
    ...(config.tools.exec || {}),
    ask: 'off',
    security: 'full',
  };

  config.channels = config.channels || {};
  config.channels.telegram = {
    ...(config.channels.telegram || {}),
    enabled: Boolean(telegramBotToken),
    actions: {
      ...(config.channels.telegram?.actions || {}),
      sendMessage: true,
    },
    mediaMaxMb: TELEGRAM_MEDIA_MAX_MB,
  };
  if (telegramBotToken) {
    config.channels.telegram.botToken = telegramBotToken;
  }

  config.auth = config.auth || {};
  config.auth.profiles = config.auth.profiles || {};
  for (const providerName of activeProviders) {
    const activeProviderConfig = PROVIDER_CONFIG[providerName];
    config.auth.profiles[activeProviderConfig.profileId] = {
      ...(config.auth.profiles[activeProviderConfig.profileId] || {}),
      provider: activeProviderConfig.provider,
      mode: 'api_key',
    };
  }

  const needsConfigUpdate = currentPrimaryModel !== providerConfig.model
    || missingModelEntries
    || currentToolsProfile !== 'full'
    || currentToolsExecAsk !== 'off'
    || currentToolsExecSecurity !== 'full'
    || currentTelegramEnabled !== Boolean(telegramBotToken)
    || (telegramBotToken && currentTelegramBotToken !== telegramBotToken)
    || currentTelegramSendMessage !== true
    || currentTelegramMediaMaxMb !== TELEGRAM_MEDIA_MAX_MB
    || activeProviders.some((providerName) => {
      const activeProviderConfig = PROVIDER_CONFIG[providerName];
      return config.auth.profiles[activeProviderConfig.profileId].provider !== activeProviderConfig.provider
        || config.auth.profiles[activeProviderConfig.profileId].mode !== 'api_key';
    })
    || (activeProviders.includes('gemini') && config.plugins?.entries?.google?.enabled !== true);

  if (needsConfigUpdate) {
    result.modelChanged = true;
    result.toolsChanged = true;
    result.provider = primaryProvider;
    writeJsonFile(configPath, config);
  }

  const authProfiles = fs.existsSync(authProfilesPath)
    ? readJsonFile(authProfilesPath)
    : { version: 1, profiles: {}, lastGood: {} };
  let authChanged = false;

  authProfiles.version = 1;
  authProfiles.profiles = authProfiles.profiles || {};
  authProfiles.lastGood = authProfiles.lastGood || {};

  for (const providerName of activeProviders) {
    const activeProviderConfig = PROVIDER_CONFIG[providerName];
    const requestedApiKey = providerName === 'openrouter'
      ? String(options.openrouterApiKey || '').trim()
      : String(options.geminiApiKey || '').trim();
    const apiKey = requestedApiKey || getSavedApiKeyForProvider(providerState.savedKeys, providerName) || getStoredApiKey(providerName);
    if (!apiKey) {
      continue;
    }

    const currentProfile = authProfiles.profiles[activeProviderConfig.profileId] || {};
    const needsAuthUpdate = currentProfile.type !== 'api_key'
      || currentProfile.provider !== activeProviderConfig.provider
      || currentProfile.key !== apiKey
      || authProfiles.lastGood[activeProviderConfig.provider] !== activeProviderConfig.profileId;

    if (needsAuthUpdate) {
      authProfiles.profiles[activeProviderConfig.profileId] = {
        type: 'api_key',
        provider: activeProviderConfig.provider,
        key: apiKey,
      };
      authProfiles.lastGood[activeProviderConfig.provider] = activeProviderConfig.profileId;
      authChanged = true;
    }
  }

  if (authChanged) {
    writeJsonFile(authProfilesPath, authProfiles);
    result.authChanged = true;
  }

  return result;
}

function runPowerShellCommand(command, options = {}) {
  const { logPrefix = 'OpenClaw', streamStdout = true, streamStderr = true } = options;

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: false,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      if (streamStdout) {
        chunk
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
          .forEach(line => sendLog(`[${logPrefix}] ${line}`));
      }
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      if (streamStderr) {
        chunk
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
          .forEach(line => sendLog(`[${logPrefix} ERROR] ${line}`));
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${logPrefix} exited with code ${code}`));
    });
  });
}

function runProcessCommand(command, args = [], options = {}) {
  const {
    logPrefix = 'OpenClaw',
    streamStdout = true,
    streamStderr = true,
    env,
    shell = false,
    stderrAsLogPatterns = [],
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell,
      env: env || process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      if (streamStdout) {
        chunk
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
          .forEach(line => sendLog(`[${logPrefix}] ${line}`));
      }
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      if (streamStderr) {
        chunk
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
          .forEach((line) => {
            const isRegularLogLine = stderrAsLogPatterns.some(pattern => pattern.test(line));
            const prefix = isRegularLogLine ? `[${logPrefix}]` : `[${logPrefix} ERROR]`;
            sendLog(`${prefix} ${line}`);
          });
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${logPrefix} exited with code ${code}`));
    });
  });
}

function refreshProcessPath() {
  const machinePath = process.env.Path || process.env.PATH || '';
  const userPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '';
  const mergedEntries = [
    ...String(machinePath).split(';'),
    userPath,
  ].filter(Boolean);
  const uniqueEntries = mergedEntries.filter((entry, index) => mergedEntries.findIndex(item => item.toLowerCase() === entry.toLowerCase()) === index);
  const refreshedPath = uniqueEntries.join(';');

  process.env.Path = refreshedPath;
  process.env.PATH = refreshedPath;
}

async function reloadProcessPathFromSystem() {
  try {
    const { stdout } = await runPowerShellCommand("[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')", {
      logPrefix: 'Prereq',
      streamStdout: false,
      streamStderr: false,
    });

    const systemPath = stdout.trim();
    if (systemPath) {
      process.env.Path = systemPath;
      process.env.PATH = systemPath;
    }
  } catch (_error) {
    refreshProcessPath();
  }
}

function addPathEntriesToProcess(entries = []) {
  const existingEntries = String(process.env.Path || process.env.PATH || '').split(';').filter(Boolean);
  const nextEntries = [...existingEntries];

  for (const entry of entries.filter(Boolean)) {
    const exists = nextEntries.some(current => current.toLowerCase() === entry.toLowerCase());
    if (!exists) {
      nextEntries.unshift(entry);
    }
  }

  const updatedPath = nextEntries.join(';');
  process.env.Path = updatedPath;
  process.env.PATH = updatedPath;
}

function parseMajorVersion(versionText) {
  const match = String(versionText || '').trim().match(/v?(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function getInstalledNodeMajorVersion() {
  try {
    const { stdout } = await runPowerShellCommand('node --version', {
      logPrefix: 'Prereq',
      streamStdout: false,
      streamStderr: false,
    });

    return parseMajorVersion(stdout);
  } catch (_error) {
    return null;
  }
}

async function isGitInstalled() {
  try {
    await runPowerShellCommand('git --version', {
      logPrefix: 'Prereq',
      streamStdout: false,
      streamStderr: false,
    });

    return true;
  } catch (_error) {
    return false;
  }
}

async function isWingetInstalled() {
  try {
    await runPowerShellCommand('winget --version', {
      logPrefix: 'Prereq',
      streamStdout: false,
      streamStderr: false,
    });

    return true;
  } catch (_error) {
    return false;
  }
}

function getPrereqInstallerDir() {
  return path.join(os.tmpdir(), 'openclaw-controller-installers');
}

function getPrereqInstallerPath(fileName) {
  fs.mkdirSync(getPrereqInstallerDir(), { recursive: true });
  return path.join(getPrereqInstallerDir(), fileName);
}

async function resolveLatestNodeMsiUrl() {
  const script = [
    "$page = Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v24.x/';",
    "$link = $page.Links | Where-Object { $_.href -match 'x64\\.msi$' } | Select-Object -First 1 -ExpandProperty href;",
    "if (-not $link) { throw 'Khong tim thay Node.js x64 MSI trong latest-v24.x'; }",
    "if ($link -match '^https?://') { Write-Output $link } else { Write-Output ('https://nodejs.org/dist/latest-v24.x/' + $link.TrimStart('/')) }",
  ].join(' ');

  const { stdout } = await runPowerShellCommand(script, {
    logPrefix: 'Prereq',
    streamStdout: false,
    streamStderr: false,
  });

  return stdout.trim();
}

async function downloadFile(url, destinationPath, label) {
  const script = [
    `$ProgressPreference = 'SilentlyContinue';`,
    `Invoke-WebRequest -UseBasicParsing -Uri ${escapePowerShellString(url)} -OutFile ${escapePowerShellString(destinationPath)};`,
    `Write-Output ${escapePowerShellString(destinationPath)};`,
  ].join(' ');

  sendLog(`[Install] Dang tai ${label} tu ${url}`);
  await runPowerShellCommand(script, {
    logPrefix: label,
    streamStdout: true,
    streamStderr: true,
  });
}

async function installWingetIfMissing() {
  const alreadyInstalled = await isWingetInstalled();
  if (alreadyInstalled) {
    return { installed: false, method: 'existing' };
  }

  const vcLibsUrl = 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx';
  const bundleUrl = 'https://aka.ms/getwinget';
  const vcLibsPath = getPrereqInstallerPath('Microsoft.VCLibs.x64.14.00.Desktop.appx');
  const bundlePath = getPrereqInstallerPath('Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle');

  sendLog('[Install] Khong tim thay winget. Dang thu cai App Installer de bo sung winget...');
  await downloadFile(vcLibsUrl, vcLibsPath, 'Microsoft.VCLibs x64');
  await downloadFile(bundleUrl, bundlePath, 'Microsoft App Installer');

  const installScript = [
    `$vcLibsPath = ${escapePowerShellString(vcLibsPath)};`,
    `$bundlePath = ${escapePowerShellString(bundlePath)};`,
    `try { Add-AppxPackage -Path $vcLibsPath -ErrorAction Stop; } catch { Write-Output ('Bo qua VCLibs: ' + $_.Exception.Message) }`,
    `Add-AppxPackage -Path $bundlePath -ErrorAction Stop;`,
    `Write-Output 'Winget installation command completed.';`,
  ].join(' ');

  await runPowerShellCommand(installScript, {
    logPrefix: 'Winget',
    streamStdout: true,
    streamStderr: true,
  });

  await reloadProcessPathFromSystem();
  const installed = await isWingetInstalled();
  if (!installed) {
    throw new Error('Da chay cai dat App Installer nhung van khong tim thay winget sau khi cai dat.');
  }

  sendLog('[Install] Da cai winget thanh cong.');
  return {
    installed: true,
    method: 'app-installer',
    vcLibsPath,
    bundlePath,
    vcLibsUrl,
    bundleUrl,
  };
}

async function installNodeWithoutWinget() {
  const downloadUrl = await resolveLatestNodeMsiUrl();
  const installerPath = getPrereqInstallerPath('node-lts-x64.msi');
  await downloadFile(downloadUrl, installerPath, 'Node.js 24 LTS');

  sendLog('[Install] Dang cai Node.js 24 LTS bang MSI...');
  await runProcessCommand('msiexec.exe', ['/i', installerPath, '/qn', '/norestart'], {
    logPrefix: 'Node.js 24 LTS',
    streamStdout: true,
    streamStderr: true,
  });

  await reloadProcessPathFromSystem();
  const installedMajor = await getInstalledNodeMajorVersion();
  if (installedMajor === null || installedMajor < 24) {
    throw new Error('Da chay installer Node.js nhung khong phat hien duoc Node.js 24+ sau khi cai dat.');
  }

  return { method: 'direct-download', installerPath, downloadUrl };
}

async function installGitWithoutWinget() {
  const downloadUrl = 'https://github.com/git-for-windows/git/releases/latest/download/Git-64-bit.exe';
  const installerPath = getPrereqInstallerPath('git-64-bit.exe');
  await downloadFile(downloadUrl, installerPath, 'Git');

  sendLog('[Install] Dang cai Git bang installer chinh thuc...');
  await runProcessCommand(installerPath, ['/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-'], {
    logPrefix: 'Git',
    streamStdout: true,
    streamStderr: true,
  });

  await reloadProcessPathFromSystem();
  const installed = await isGitInstalled();
  if (!installed) {
    throw new Error('Da chay installer Git nhung van khong tim thay git --version sau khi cai dat.');
  }

  return { method: 'direct-download', installerPath, downloadUrl };
}

async function installPackageWithoutWinget(pkg) {
  if (pkg.id === 'OpenJS.NodeJS.LTS') {
    return installNodeWithoutWinget();
  }

  if (pkg.id === 'Git.Git') {
    return installGitWithoutWinget();
  }

  throw new Error(`Chua co fallback installer cho prerequisite ${pkg.label}`);
}

async function installWingetPackage(packageId, label) {
  sendLog(`[Install] Dang cai ${label}...`);

  const installCommand = [
    'winget install',
    '--id',
    packageId,
    '--exact',
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--silent',
  ].join(' ');

  const { stdout, stderr } = await runPowerShellCommand(installCommand, {
    logPrefix: label,
    streamStdout: true,
    streamStderr: true,
  });

  await reloadProcessPathFromSystem();
  sendLog(`[Install] Da cai ${label}.`);
  return stdout || stderr || null;
}

async function ensureInstallPrerequisites() {
  const nodeMajor = await getInstalledNodeMajorVersion();
  const gitInstalled = await isGitInstalled();
  const missingPackages = [];

  if (nodeMajor === null || nodeMajor < 24) {
    missingPackages.push({
      id: 'OpenJS.NodeJS.LTS',
      label: 'Node.js 24 LTS',
      reason: nodeMajor === null ? 'Node.js chua duoc cai dat' : `Node.js hien tai la v${nodeMajor}, can toi thieu v24`,
    });
  }

  if (!gitInstalled) {
    missingPackages.push({
      id: 'Git.Git',
      label: 'Git',
      reason: 'Git chua duoc cai dat',
    });
  }

  if (missingPackages.length === 0) {
    sendLog('[Install] He thong da san sang: co Node.js 24+ va Git.');
    return { installed: [], alreadySatisfied: true };
  }

  let wingetInstalled = await isWingetInstalled();
  let wingetInstallResult = null;
  if (!wingetInstalled) {
    try {
      wingetInstallResult = await installWingetIfMissing();
      wingetInstalled = await isWingetInstalled();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      sendLog(`[Install] Cai winget khong thanh cong: ${errorMessage}`);
      sendLog('[Install] Se dung fallback installer chinh thuc cho Node.js/Git.');
    }
  }

  sendLog(`[Install] Thieu prerequisite: ${missingPackages.map(pkg => `${pkg.label} (${pkg.reason})`).join(', ')}`);

  const installedPackages = [];
  for (const pkg of missingPackages) {
    if (wingetInstalled) {
      const output = await installWingetPackage(pkg.id, pkg.label);
      installedPackages.push({ ...pkg, output, installMethod: wingetInstallResult?.installed ? 'winget-after-install' : 'winget', wingetInstallResult });
      continue;
    }

    const fallbackResult = await installPackageWithoutWinget(pkg);
    installedPackages.push({ ...pkg, output: null, installMethod: fallbackResult.method, ...fallbackResult });
  }

  return { installed: installedPackages, alreadySatisfied: false };
}

async function ensureOpenClawPathForCurrentSession() {
  await reloadProcessPathFromSystem();

  try {
    const { stdout } = await runProcessCommand('cmd.exe', ['/d', '/c', 'npm.cmd', 'config', 'get', 'prefix'], {
      logPrefix: 'Install',
      streamStdout: false,
      streamStderr: false,
    });

    const prefix = stdout.trim();
    const pathCandidates = [
      prefix,
      prefix ? path.join(prefix, 'bin') : null,
      process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null,
    ].filter(Boolean);

    addPathEntriesToProcess(pathCandidates);
  } catch (_error) {
    addPathEntriesToProcess([
      process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null,
    ]);
  }
}

async function getNpmGlobalPrefix() {
  await reloadProcessPathFromSystem();

  try {
    const { stdout } = await runProcessCommand('cmd.exe', ['/d', '/c', 'npm.cmd', 'config', 'get', 'prefix'], {
      logPrefix: 'OpenClaw',
      streamStdout: false,
      streamStderr: false,
    });

    return stdout.trim() || (process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null);
  } catch (_error) {
    return process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null;
  }
}

async function removeOpenClawCliArtifacts() {
  const npmPrefix = await getNpmGlobalPrefix();
  if (!npmPrefix || !fs.existsSync(npmPrefix)) {
    return { removed: [] };
  }

  const removed = [];
  const targets = [
    path.join(npmPrefix, 'node_modules', 'openclaw'),
    path.join(npmPrefix, 'openclaw'),
    path.join(npmPrefix, 'openclaw.cmd'),
    path.join(npmPrefix, 'openclaw.ps1'),
  ];

  for (const targetPath of targets) {
    if (!fs.existsSync(targetPath)) {
      continue;
    }

    fs.rmSync(targetPath, { recursive: true, force: true });
    removed.push(targetPath);
  }

  for (const entry of fs.readdirSync(npmPrefix, { withFileTypes: true })) {
    if (!entry.name.startsWith('.openclaw')) {
      continue;
    }

    const targetPath = path.join(npmPrefix, entry.name);
    fs.rmSync(targetPath, { recursive: true, force: true });
    removed.push(targetPath);
  }

  const nodeModulesDir = path.join(npmPrefix, 'node_modules');
  if (fs.existsSync(nodeModulesDir)) {
    for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
      if (!entry.name.startsWith('.openclaw')) {
        continue;
      }

      const targetPath = path.join(nodeModulesDir, entry.name);
      fs.rmSync(targetPath, { recursive: true, force: true });
      removed.push(targetPath);
    }
  }

  return { removed };
}

async function getInstalledOpenClawVersion() {
  await ensureOpenClawPathForCurrentSession();

  try {
    const { stdout } = await runProcessCommand('cmd.exe', ['/d', '/c', 'openclaw.cmd', '--version'], {
      logPrefix: 'Install',
      streamStdout: false,
      streamStderr: false,
    });

    const output = stdout.trim();
    if (!output) {
      return null;
    }

    const match = output.match(/OpenClaw\s+([^\s]+)/i);
    return match ? match[1] : output;
  } catch (_error) {
    return null;
  }
}

async function getOpenClawCommandPath() {
  const npmPrefix = await getNpmGlobalPrefix();
  const candidates = [
    npmPrefix ? path.join(npmPrefix, 'openclaw.cmd') : null,
    npmPrefix ? path.join(npmPrefix, 'openclaw') : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'openclaw.cmd') : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'openclaw.cmd';
}

async function runOpenClawCli(args, options = {}) {
  const commandPath = await getOpenClawCommandPath();
  const argList = args.map(arg => escapePowerShellString(arg)).join(' ');
  const command = argList
    ? `& ${escapePowerShellString(commandPath)} ${argList}`
    : `& ${escapePowerShellString(commandPath)}`;

  return runPowerShellCommand(command, options);
}

async function configureOpenClawAfterInstall(params = {}) {
  const provider = normalizeProvider(params.provider) || 'openrouter';
  const providerConfig = PROVIDER_CONFIG[provider];
  const geminiApiKey = String(params.geminiApiKey || '').trim();
  const openrouterApiKey = String(params.openrouterApiKey || '').trim();
  const telegramBotToken = String(params.telegramBotToken || '').trim();
  const details = {
    provider,
    configuredProviders: [],
    gatewayMode: 'local',
    providerConfigured: false,
    defaultModel: null,
    configPath: null,
    authProfilesPath: null,
  };

  sendLog('[Install] Dang cau hinh OpenClaw sau cai dat...');

  await runOpenClawCli(['config', 'set', 'gateway.mode', 'local'], {
    logPrefix: 'Install Config',
    streamStdout: true,
    streamStderr: true,
  });

  if (geminiApiKey) {
    sendLog('[Install] Dang them Gemini API key va ep model mac dinh sang gemini-2.5-flash...');
    await runOpenClawCli([
      'onboard',
      '--mode',
      'local',
      '--non-interactive',
      '--accept-risk',
      '--auth-choice',
      'gemini-api-key',
      '--gemini-api-key',
      geminiApiKey,
      '--skip-daemon',
      '--skip-ui',
      '--skip-channels',
      '--skip-search',
      '--skip-skills',
      '--json',
    ], {
      logPrefix: 'Gemini Setup',
      streamStdout: true,
      streamStderr: true,
    });
    details.configuredProviders.push('gemini');
  }

  if (openrouterApiKey) {
    sendLog(`[Install] Dang them OpenRouter API key va ep model mac dinh sang ${OPENCLAW_OPENROUTER_MODEL}...`);
    details.configuredProviders.push('openrouter');
  }

  let selectedModel = null;
  let lastModelSetError = null;

  for (const modelName of providerConfig.fallbackModels) {
    try {
      sendLog(`[Install] Dang dat model mac dinh: ${modelName}`);
      await runOpenClawCli(['models', 'set', modelName], {
        logPrefix: `${providerConfig.label} Setup`,
        streamStdout: true,
        streamStderr: true,
      });
      selectedModel = modelName;
      break;
    } catch (error) {
      lastModelSetError = error;
      sendLog(`[Install] Khong dat duoc model ${modelName}: ${error.message}`);
    }
  }

  if (!selectedModel && provider === 'gemini') {
    throw lastModelSetError || new Error('Khong the dat model gemini-2.5-flash.');
  }

  details.providerConfigured = details.configuredProviders.length > 0;
  details.defaultModel = providerConfig.model;

  if (!selectedModel && provider === 'openrouter') {
    sendLog(`[Install] Se ghi truc tiep config de dung model ${OPENCLAW_OPENROUTER_MODEL}.`);
  }

  sendLog('[Install] Dang cau hinh tools profile va exec security...');
  await runOpenClawCli(['config', 'set', 'tools.exec.ask', 'off'], {
    logPrefix: 'Install Config',
    streamStdout: true,
    streamStderr: true,
  });
  await runOpenClawCli(['config', 'set', 'tools.exec.security', 'full'], {
    logPrefix: 'Install Config',
    streamStdout: true,
    streamStderr: true,
  });
  await runOpenClawCli(['config', 'set', 'tools.profile', 'full'], {
    logPrefix: 'Install Config',
    streamStdout: true,
    streamStderr: true,
  });

  if (telegramBotToken) {
    sendLog('[Install] Dang bat channel Telegram...');
    await runOpenClawCli(['config', 'set', 'channels.telegram.enabled', 'true'], {
      logPrefix: 'Install Config',
      streamStdout: true,
      streamStderr: true,
    });
    await runOpenClawCli(['config', 'set', 'channels.telegram.botToken', telegramBotToken], {
      logPrefix: 'Install Config',
      streamStdout: true,
      streamStderr: true,
    });
    await runOpenClawCli(['config', 'set', 'channels.telegram.actions.sendMessage', 'true'], {
      logPrefix: 'Install Config',
      streamStdout: true,
      streamStderr: true,
    });
    await runOpenClawCli(['config', 'set', 'channels.telegram.mediaMaxMb', String(TELEGRAM_MEDIA_MAX_MB)], {
      logPrefix: 'Install Config',
      streamStdout: true,
      streamStderr: true,
    });
  }

  const reconciled = await reconcileOpenClawConfigState({
    provider,
    geminiApiKey,
    openrouterApiKey,
    telegramBotToken,
  });
  if (reconciled.modelChanged) {
    sendLog(`[Install] Da sua ${reconciled.configPath} ve model ${providerConfig.model}`);
  }
  if (reconciled.toolsChanged) {
    sendLog('[Install] Da dong bo tools.exec.ask=off, tools.exec.security=full, tools.profile=full');
  }
  if (reconciled.authChanged) {
    sendLog(`[Install] Da dong bo auth profiles tai ${reconciled.authProfilesPath}`);
  }

  details.configPath = reconciled.configPath;
  details.authProfilesPath = reconciled.authProfilesPath;

  sendLog(`[Install] Da khoi tao gateway.mode local, tools profile, va provider ${providerConfig.label}.`);
  return details;
}

async function getGatewayListenerPids() {
  const { stdout } = await runPowerShellCommand(
    'Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique',
    {
      logPrefix: 'Stop',
      streamStdout: false,
      streamStderr: false,
    },
  );

  return stdout
    .split(/\r?\n/)
    .map(line => Number(line.trim()))
    .filter(pid => Number.isInteger(pid) && pid > 0);
}

async function stopExternalGatewayProcesses() {
  const pids = await getGatewayListenerPids();

  if (pids.length === 0) {
    return {
      status: 'idle',
      message: 'Khong tim thay tien trinh OpenClaw nao dang nghe cong 18789',
      details: { pids: [] },
    };
  }

  sendLog(`[Stop] Tim thay PID ngoai app: ${pids.join(', ')}`);

  const outputs = [];
  for (const pid of pids) {
    const command = `taskkill /PID ${pid} /T /F`;
    sendLog(`[Stop] Dang dung PID ngoai app ${pid}`);
    const { stdout, stderr } = await runPowerShellCommand(command, {
      logPrefix: 'Stop',
      streamStdout: true,
      streamStderr: true,
    });
    outputs.push(stdout || stderr || `Da dung PID ${pid}`);
  }

  return {
    status: 'ok',
    message: outputs.join('\n'),
    details: { pids, scope: 'external-listener' },
  };
}

async function stopProcessesByPattern(pattern, label) {
  const escapedPattern = pattern.replace(/'/g, "''");
  const findCommand = [
    "$matches = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '",
    escapedPattern,
    "' } | Select-Object -ExpandProperty ProcessId;",
    'if ($matches) { $matches | Sort-Object -Unique | ForEach-Object { Write-Output $_ } }',
  ].join('');

  const { stdout } = await runPowerShellCommand(findCommand, {
    logPrefix: label,
    streamStdout: false,
    streamStderr: false,
  });

  const pids = stdout
    .split(/\r?\n/)
    .map(line => Number(line.trim()))
    .filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

  for (const pid of pids) {
    sendLog(`[Install] Dang dung ${label} PID ${pid}`);
    await runPowerShellCommand(`taskkill /PID ${pid} /T /F`, {
      logPrefix: label,
      streamStdout: true,
      streamStderr: true,
    });
  }

  return pids;
}

async function cleanupBrokenOpenClawInstallArtifacts() {
  const npmRoot = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null;
  if (!npmRoot || !fs.existsSync(npmRoot)) {
    return;
  }

  const packageDir = path.join(npmRoot, 'node_modules', 'openclaw');
  const packageJsonPath = path.join(packageDir, 'package.json');

  if (fs.existsSync(packageDir) && !fs.existsSync(packageJsonPath)) {
    sendLog('[Install] Phat hien ban cai OpenClaw dang do. Dang don thu muc cu...');
    fs.rmSync(packageDir, { recursive: true, force: true });
  }

  for (const entry of fs.readdirSync(npmRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith('.openclaw')) {
      continue;
    }

    const targetPath = path.join(npmRoot, entry.name);
    sendLog(`[Install] Don artifact tam: ${entry.name}`);
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

async function prepareForOpenClawInstall() {
  sendLog('[Install] Dang don moi truong truoc khi cai/upgrade OpenClaw...');
  await stopExternalGatewayProcesses().catch(() => null);
  await stopProcessesByPattern('npm-cli\\.js" install -g openclaw@latest', 'Install Cleanup');
  await stopProcessesByPattern('openclaw\\.mjs gateway run', 'Gateway Cleanup');
  await cleanupBrokenOpenClawInstallArtifacts();
  await reloadProcessPathFromSystem();
}

async function installOpenClawPackage(tag = 'latest') {
  await reloadProcessPathFromSystem();
  const installArgs = ['install', '-g', `openclaw@${tag}`, '--force', '--loglevel', 'verbose', '--foreground-scripts'];
  sendLog('[Install] Dang cai OpenClaw bang npm. Buoc nay co the mat vai phut.');
  sendLog(`[Install] Lenh: npm.cmd ${installArgs.join(' ')}`);

  const npmEnv = {
    ...process.env,
    NPM_CONFIG_SCRIPT_SHELL: 'cmd.exe',
    NPM_CONFIG_LOGLEVEL: 'verbose',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_AUDIT: 'false',
    NODE_LLAMA_CPP_SKIP_DOWNLOAD: '1',
  };

  const result = await runProcessCommand('cmd.exe', ['/d', '/c', 'npm.cmd', ...installArgs], {
    logPrefix: 'Install',
    streamStdout: true,
    streamStderr: true,
    env: npmEnv,
    stderrAsLogPatterns: [/^npm\s+(verbose|info|http|silly|notice|warn)\b/i],
  });

  await ensureOpenClawPathForCurrentSession();
  sendLog('[Install] Da cai OpenClaw xong.');
  return result;
}

async function handleInstall(params = {}) {
  const installParams = await resolveEffectiveKeyParams(params);

  if (!installParams.provider) {
    throw new Error('Can nhap OpenRouter API key hoac Gemini API key truoc khi cai OpenClaw.');
  }

  await saveKeys(installParams);

  const prerequisiteResult = await ensureInstallPrerequisites();
  const existingVersion = await getInstalledOpenClawVersion();

  if (existingVersion) {
    sendLog(`[Install] OpenClaw da duoc cai san: ${existingVersion}`);
    const configured = await configureOpenClawAfterInstall(installParams);
    return {
      status: 'ok',
      message: `OpenClaw da duoc cai dat (${existingVersion}) va da cau hinh ${PROVIDER_CONFIG[installParams.provider].label}`,
      details: {
        command: 'openclaw.cmd --version',
        interactive: false,
        prerequisites: prerequisiteResult,
        version: existingVersion,
        configured,
      },
    };
  }

  await prepareForOpenClawInstall();
  const installResult = await installOpenClawPackage();
  const configured = await configureOpenClawAfterInstall(installParams);

  return {
    status: 'ok',
    message: `Da cai dat OpenClaw va cau hinh ${PROVIDER_CONFIG[installParams.provider].label} thanh cong`,
    details: {
      command: 'npm.cmd install -g openclaw@latest --force --loglevel verbose --foreground-scripts',
      interactive: false,
      prerequisites: prerequisiteResult,
      output: installResult.stdout || installResult.stderr || null,
      configured,
    },
  };
}

async function handleSaveKeys(params = {}) {
  const saveParams = await resolveEffectiveKeyParams(params);

  if (!saveParams.openrouterApiKey && !saveParams.geminiApiKey && !saveParams.telegramBotToken) {
    throw new Error('Can nhap it nhat mot key OpenRouter, Gemini hoac Telegram truoc khi luu.');
  }

  await saveKeys(saveParams);
  sendLog('[Config] Dang luu key va dong bo cau hinh OpenClaw...');
  const reconciled = await reconcileOpenClawConfigState(saveParams);
  const savedProviders = [];
  if (saveParams.openrouterApiKey) {
    savedProviders.push('OpenRouter');
  }
  if (saveParams.geminiApiKey) {
    savedProviders.push('Gemini');
  }

  return {
    status: 'ok',
    message: `Da luu key ${savedProviders.join(' va ')}`,
    details: {
      savedProviders,
      configPath: reconciled.configPath,
      authProfilesPath: reconciled.authProfilesPath,
      defaultProvider: reconciled.provider,
    },
  };
}

async function handleConnectTelegram(params = {}) {
  const pairingCode = String(params?.pairingCode || '').trim();
  const telegramBotToken = await getTelegramBotTokenFromStore();

  if (telegramBotToken) {
    const configPath = getOpenClawConfigPath();
    const config = fs.existsSync(configPath) ? readJsonFile(configPath) : buildBaseOpenClawConfig('gemini');
    config.channels = config.channels || {};
    config.channels.telegram = {
      ...(config.channels.telegram || {}),
      enabled: true,
      botToken: telegramBotToken,
      dmPolicy: 'pairing',
      groups: {
        ...(config.channels.telegram?.groups || {}),
        '*': {
          ...(config.channels.telegram?.groups?.['*'] || {}),
          requireMention: true,
        },
      },
      actions: {
        ...(config.channels.telegram?.actions || {}),
        sendMessage: true,
      },
      mediaMaxMb: TELEGRAM_MEDIA_MAX_MB,
    };
    writeJsonFile(configPath, config);
    sendLog('[Telegram] Da dat cau hinh Telegram ve che do pairing va cap nhat bot token tu key store.');
  } else if (!pairingCode) {
    throw new Error('Khong tim thay Telegram bot token trong key store. Hay luu Telegram bot token truoc khi connect Telegram.');
  }

  if (!pairingCode) {
    sendLog('[Telegram] Da bat che do pairing. Hay nhan bot Telegram de lay pairing code, sau do nhap code vao app.');
    const { stdout, stderr } = await runOpenClawCli(['pairing', 'list', 'telegram', '--json'], {
      logPrefix: 'Telegram Pairing List',
      streamStdout: true,
      streamStderr: true,
    });
    const rawOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
    let pendingRequests = [];

    if (stdout && stdout.trim()) {
      try {
        const parsedOutput = JSON.parse(stdout.trim());
        pendingRequests = Array.isArray(parsedOutput)
          ? parsedOutput
          : Array.isArray(parsedOutput?.requests)
            ? parsedOutput.requests
            : [];
      } catch (_error) {
        pendingRequests = [];
      }
    }

    return {
      status: 'ok',
      message: pendingRequests.length > 0
        ? 'Da tai danh sach pairing Telegram. Nhap code roi bam lai nut de approve.'
        : 'Da dat Telegram ve che do pairing. Hay mo Telegram, nhan cho bot cua ban de lay pairing code, sau do nhap code vao app.',
      details: {
        command: 'openclaw pairing list telegram --json',
        pendingRequests,
        rawOutput,
        requiresPairingCode: true,
      },
    };
  }

  const { stdout: pendingStdout } = await runOpenClawCli(['pairing', 'list', 'telegram', '--json'], {
    logPrefix: 'Telegram Pairing List',
    streamStdout: false,
    streamStderr: false,
  });

  let pendingRequests = [];
  if (pendingStdout && pendingStdout.trim()) {
    try {
      const parsedOutput = JSON.parse(pendingStdout.trim());
      pendingRequests = Array.isArray(parsedOutput)
        ? parsedOutput
        : Array.isArray(parsedOutput?.requests)
          ? parsedOutput.requests
          : [];
    } catch (_error) {
      pendingRequests = [];
    }
  }

  const hasMatchingRequest = pendingRequests.some((request) => {
    if (!request || typeof request !== 'object') {
      return false;
    }

    return Object.values(request).some((value) => String(value || '').trim().toUpperCase() === pairingCode.toUpperCase());
  });

  if (!hasMatchingRequest) {
    throw new Error('Khong tim thay pairing request dang cho cho code nay. Hay mo Telegram, nhan lai vao bot de lay code moi, sau do bam Connect Telegram lai.');
  }

  sendLog('[Telegram] Dang approve pairing code Telegram...');
  await runOpenClawCli(['pairing', 'approve', 'telegram', pairingCode], {
    logPrefix: 'Telegram Pairing',
    streamStdout: true,
    streamStderr: true,
  });

  return {
    status: 'ok',
    message: 'Da connect Telegram thanh cong',
    details: {
      command: `openclaw pairing approve telegram ${pairingCode}`,
      requiresPairingCode: false,
    },
  };
}

async function handleSetFullRights() {
  sendLog('========================================');
  sendLog('   Dang thiet lap OpenClaw FULL RIGHTS   ');
  sendLog('        (Sandbox OFF + Elevated)         ');
  sendLog('========================================');

  const configSteps = [
    {
      message: '[Full Rights] Tat sandbox...',
      args: ['config', 'set', 'agents.defaults.sandbox.mode', 'off'],
    },
    {
      message: '[Full Rights] Bat full tools profile...',
      args: ['config', 'set', 'tools.profile', 'full'],
    },
    {
      message: '[Full Rights] Bat full exec security...',
      args: ['config', 'set', 'tools.exec.security', 'full'],
    },
    {
      message: '[Full Rights] Tat hoi approval khi chay lenh...',
      args: ['config', 'set', 'tools.exec.ask', 'off'],
    },
    {
      message: '[Full Rights] Bat elevated mode...',
      args: ['config', 'set', 'tools.elevated.enabled', 'true'],
    },
  ];

  for (const step of configSteps) {
    sendLog(step.message);
    await runOpenClawCli(step.args, {
      logPrefix: 'Full Rights',
      streamStdout: true,
      streamStderr: true,
    });
  }

  sendLog('[Full Rights] Dang copy folder skills vao workspace...');
  const copiedSkills = copyBundledSkillsToWorkspace();
  sendLog(`[Full Rights] Da copy skills tu ${copiedSkills.sourcePath} sang ${copiedSkills.destinationPath}`);
  if (copiedSkills.copiedEntries.length > 0) {
    sendLog(`[Full Rights] Skills da copy: ${copiedSkills.copiedEntries.join(', ')}`);
  }

  sendLog('[Full Rights] Restarting OpenClaw...');
  await runOpenClawCli(['restart'], {
    logPrefix: 'Full Rights',
    streamStdout: true,
    streamStderr: true,
  });

  sendLog('========================================');
  sendLog('HOAN TAT! OpenClaw da duoc set full quyen.');
  sendLog('Ban co the kiem tra bang lenh: openclaw status');
  sendLog('========================================');

  return {
    status: 'ok',
    message: 'Da set full quyen cho OpenClaw thanh cong',
    details: {
      command: 'openclaw config set ...; openclaw restart',
      restartRequested: true,
      workspaceSkillsPath: copiedSkills.destinationPath,
      copiedSkills: copiedSkills.copiedEntries,
    },
  };
}

async function handleUninstall() {
  sendLog('[Uninstall] Starting uninstall process...');

  await stopExternalGatewayProcesses().catch(() => null);
  await stopProcessesByPattern('openclaw\\.mjs gateway run', 'Uninstall Cleanup').catch(() => null);
  await stopProcessesByPattern('npm-cli\\.js" (install|uninstall) -g openclaw', 'Uninstall Cleanup').catch(() => null);

  const uninstallCommand = 'openclaw uninstall --all --yes --non-interactive';
  let uninstallOutput = null;

  try {
    const { stdout, stderr } = await runPowerShellCommand(uninstallCommand, {
      logPrefix: 'Uninstall',
      streamStdout: true,
      streamStderr: true,
    });
    uninstallOutput = stdout || stderr || null;
  } catch (error) {
    sendLog(`[Uninstall] Lenh openclaw uninstall khong chay tron ven: ${error.message}`);
  }

  const cliCleanup = await removeOpenClawCliArtifacts();
  await reloadProcessPathFromSystem();
  sendLog('[Uninstall] Da go sach OpenClaw va CLI global.');

  return {
    status: 'ok',
    message: 'Da go sach OpenClaw',
    details: {
      command: uninstallCommand,
      output: uninstallOutput,
      removedCliArtifacts: cliCleanup.removed,
    },
  };
}

async function handleTask(command, params) {
  if (command === 'install') {
    return handleInstall(params);
  }

  if (command === 'save-keys') {
    return handleSaveKeys(params);
  }

  if (command === 'connect-telegram') {
    return handleConnectTelegram(params);
  }

  if (command === 'set-full-rights') {
    return handleSetFullRights();
  }

  if (command === 'uninstall') {
    return handleUninstall();
  }

  throw new Error(`Unsupported worker command: ${command}`);
}

process.on('message', async (message) => {
  if (!message || message.type !== 'run-task') {
    return;
  }

  try {
    const result = await handleTask(message.command, message.params || {});
    sendResult(result);
  } catch (error) {
    sendError(error);
  }
});

process.on('uncaughtException', sendError);
process.on('unhandledRejection', sendError);