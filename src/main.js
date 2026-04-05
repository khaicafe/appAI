const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { fork, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const { getSavedKeys, saveKeys } = require('./key-store');

let mainWindow;
let gatewayProcess;
let logicTaskProcess;
let gatewayReady = false;
let gatewayInfo = {};
let gatewayDashboardOpened = false;
let gatewayDashboardRefreshTimer = null;

const gatewayDashboardUrl = 'http://localhost:18789/';
const OPENCLAW_GEMINI_FLASH_MODEL = 'google/gemini-2.5-flash';
const OPENCLAW_GOOGLE_PROFILE_ID = 'google:default';
const OPENCLAW_OPENROUTER_MODEL = 'openrouter/qwen/qwen3.6-plus:free';
const OPENCLAW_OPENROUTER_PROFILE_ID = 'openrouter:default';
const TELEGRAM_MEDIA_MAX_MB = 100;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

const GEMINI_MODEL_ENTRIES = {
  'google/gemini-flash-latest': { alias: 'Gemini Flash Latest' },
  'google/gemini-2.5-flash': { alias: 'Gemini 2.5 Flash' },
  'google/gemini-2.5-pro': { alias: 'Gemini 2.5 Pro' },
  'google/gemini-2.0-flash': { alias: 'Gemini 2.0 Flash' },
};

const PROVIDER_CONFIG = {
  gemini: {
    model: OPENCLAW_GEMINI_FLASH_MODEL,
    profileId: OPENCLAW_GOOGLE_PROFILE_ID,
    provider: 'google',
    pluginKey: 'google',
    modelEntries: GEMINI_MODEL_ENTRIES,
  },
  openrouter: {
    model: OPENCLAW_OPENROUTER_MODEL,
    profileId: OPENCLAW_OPENROUTER_PROFILE_ID,
    provider: 'openrouter',
    pluginKey: null,
    modelEntries: {
      'openrouter/auto': { alias: 'OpenRouter' },
      [OPENCLAW_OPENROUTER_MODEL]: { alias: 'OpenRouter Free' },
    },
  },
};

function resetGatewayState() {
  gatewayReady = false;
  gatewayDashboardOpened = false;
  gatewayInfo = {};
  if (gatewayDashboardRefreshTimer) {
    clearTimeout(gatewayDashboardRefreshTimer);
    gatewayDashboardRefreshTimer = null;
  }
  gatewayProcess = null;
}

function focusExistingMainWindow() {
  if (!mainWindow) {
    const [existingWindow] = BrowserWindow.getAllWindows();
    if (existingWindow) {
      mainWindow = existingWindow;
    }
  }

  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
  mainWindow.moveTop();
}

function sendRendererLog(message) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('gateway-log', message);
  }
}

function sendLogicTaskState(state) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('logic-task-state', state);
  }
}

function hasActiveLogicTask() {
  return Boolean(logicTaskProcess && !logicTaskProcess.killed);
}

function runLogicTask(command, params = {}) {
  if (hasActiveLogicTask()) {
    throw new Error('Dang co mot tac vu cai dat/go bo khac dang chay.');
  }

  const workerPath = path.join(__dirname, 'openclaw-worker.js');

  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: process.env,
    });

    logicTaskProcess = child;
    sendLogicTaskState({ busy: true, command });
    let settled = false;

    const clearActiveTask = () => {
      if (logicTaskProcess === child) {
        logicTaskProcess = null;
      }
      sendLogicTaskState({ busy: false, command: null });
    };

    const settleSuccess = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      clearActiveTask();
      if (!child.killed) {
        child.kill();
      }
      resolve(result);
    };

    const settleError = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearActiveTask();
      if (!child.killed) {
        child.kill();
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    child.on('message', (message) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'log' && message.message) {
        sendRendererLog(message.message);
        return;
      }

      if (message.type === 'result') {
        settleSuccess(message.result);
        return;
      }

      if (message.type === 'error') {
        settleError(new Error(message.error?.message || 'Logic worker failed'));
      }
    });

    child.on('error', (error) => {
      settleError(error);
    });

    child.on('exit', (code, signal) => {
      clearActiveTask();
      if (!settled) {
        settleError(new Error(`Logic worker exited unexpectedly (code=${code}, signal=${signal || 'none'})`));
      }
    });

    child.send({
      type: 'run-task',
      command,
      params,
    });
  });
}

function getOpenClawConfigPath() {
  return path.join(app.getPath('home'), '.openclaw', 'openclaw.json');
}

function getOpenClawAgentAuthProfilesPath() {
  return path.join(app.getPath('home'), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
}

function getOpenClawCredentialsPath() {
  return path.join(app.getPath('home'), '.openclaw', 'credentials');
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function countJsonEntries(value) {
  if (!value) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  if (typeof value === 'object') {
    if (Array.isArray(value.requests)) {
      return value.requests.length;
    }

    return Object.keys(value).length;
  }

  return 0;
}

function normalizeTelegramAllowlistEntry(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return null;
  }

  const normalizedValue = rawValue.replace(/^(telegram:|tg:)/i, '');
  if (/^-?\d{5,}$/.test(normalizedValue)) {
    return normalizedValue;
  }

  const username = normalizedValue.startsWith('@') ? normalizedValue.slice(1) : normalizedValue;
  if (/^[A-Za-z][A-Za-z0-9_]{4,}$/.test(username)) {
    return `@${username}`;
  }

  return null;
}

function collectTelegramAllowlistEntries(value, collected = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' || typeof entry === 'number') {
        const normalizedEntry = normalizeTelegramAllowlistEntry(entry);
        if (normalizedEntry) {
          collected.add(normalizedEntry);
        }
        continue;
      }

      collectTelegramAllowlistEntries(entry, collected);
    }

    return collected;
  }

  if (!value || typeof value !== 'object') {
    return collected;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = normalizeTelegramAllowlistEntry(key);
    if (normalizedKey && nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      collected.add(normalizedKey);
    }

    if (['id', 'userId', 'candidateId', 'username'].includes(key) && (typeof nestedValue === 'string' || typeof nestedValue === 'number')) {
      const normalizedEntry = normalizeTelegramAllowlistEntry(nestedValue);
      if (normalizedEntry) {
        collected.add(normalizedEntry);
      }
      continue;
    }

    collectTelegramAllowlistEntries(nestedValue, collected);
  }

  return collected;
}

function getTelegramPairingState() {
  const credentialsPath = getOpenClawCredentialsPath();
  const pendingPath = path.join(credentialsPath, 'telegram-pairing.json');
  let pendingCount = 0;
  let approvedCount = 0;
  let configuredAllowFromCount = 0;

  if (fs.existsSync(pendingPath)) {
    try {
      pendingCount = countJsonEntries(readJsonFile(pendingPath));
    } catch (_error) {
      pendingCount = 0;
    }
  }

  if (fs.existsSync(credentialsPath)) {
    try {
      const files = fs.readdirSync(credentialsPath);
      const allowFiles = files.filter((fileName) => /^telegram(?:-[^-][^/]*)?-allowFrom\.json$/i.test(fileName) || /^telegram-.*-allowFrom\.json$/i.test(fileName));

      for (const fileName of allowFiles) {
        const filePath = path.join(credentialsPath, fileName);
        try {
          approvedCount += countJsonEntries(readJsonFile(filePath));
        } catch (_error) {
          approvedCount += 0;
        }
      }
    } catch (_error) {
      approvedCount = 0;
    }
  }

  try {
    const configPath = getOpenClawConfigPath();
    if (fs.existsSync(configPath)) {
      const config = readJsonFile(configPath);
      configuredAllowFromCount = collectTelegramAllowlistEntries(config?.channels?.telegram?.allowFrom || []).size;
    }
  } catch (_error) {
    configuredAllowFromCount = 0;
  }

  let status = 'unpaired';
  let message = 'Telegram chưa pair. Hãy nhắn bot để lấy pairing code mới.';

  if ((approvedCount > 0 || configuredAllowFromCount > 0) && pendingCount > 0) {
    status = 'paired-with-pending';
    message = configuredAllowFromCount > 0
      ? `Telegram đã nằm trong allowlist bền vững. Hiện còn ${pendingCount} yêu cầu pairing mới đang chờ.`
      : `Telegram đã pair rồi, không cần nhập code nữa. Hiện còn ${pendingCount} yêu cầu pairing mới đang chờ.`;
  } else if (configuredAllowFromCount > 0) {
    status = 'paired';
    message = 'Telegram đã nằm trong allowlist bền vững, không cần pair lại sau khi cài lại OpenClaw.';
  } else if (approvedCount > 0) {
    status = 'paired';
    message = 'Telegram đã pair rồi. Bấm Connect Telegram để đồng bộ vào allowlist bền vững.';
  } else if (pendingCount > 0) {
    status = 'pending';
    message = `Đang có ${pendingCount} yêu cầu pairing Telegram chờ duyệt. Hãy nhập pairing code để approve.`;
  }

  return {
    status,
    message,
    approvedCount,
    pendingCount,
    configuredAllowFromCount,
  };
}

function addPathEntriesToProcess(entries) {
  const values = entries
    .filter(Boolean)
    .map(entry => path.resolve(entry));

  if (values.length === 0) {
    return;
  }

  const currentPath = String(process.env.PATH || '');
  const pathEntries = currentPath.split(path.delimiter).filter(Boolean);
  const normalized = new Set(pathEntries.map(entry => entry.toLowerCase()));

  for (const value of values) {
    if (!normalized.has(value.toLowerCase())) {
      pathEntries.unshift(value);
      normalized.add(value.toLowerCase());
    }
  }

  process.env.PATH = pathEntries.join(path.delimiter);
}

async function ensureOpenClawPathForCurrentSession() {
  try {
    const { stdout } = await runProcessCommand('cmd.exe', ['/d', '/c', 'npm.cmd', 'config', 'get', 'prefix'], {
      logPrefix: 'OpenClaw',
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
  await ensureOpenClawPathForCurrentSession();

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

  return null;
}

async function detectOpenClawInstallation() {
  const commandPath = await getOpenClawCommandPath();
  const configPath = getOpenClawConfigPath();
  const authProfilesPath = getOpenClawAgentAuthProfilesPath();

  return {
    commandPath,
    configPath,
    authProfilesPath,
    commandExists: Boolean(commandPath),
    configExists: fs.existsSync(configPath),
    authExists: fs.existsSync(authProfilesPath),
  };
}

async function getInstalledOpenClawVersion() {
  const installation = await detectOpenClawInstallation();
  if (!installation.commandPath) {
    return null;
  }

  try {
    const { stdout } = await runProcessCommand('cmd.exe', ['/d', '/c', installation.commandPath, '--version'], {
      logPrefix: 'OpenClaw',
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

function normalizeProvider(provider) {
  return provider === 'gemini' || provider === 'openrouter' ? provider : null;
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

function getSavedApiKeyForProvider(savedKeys, provider) {
  if (!savedKeys || typeof savedKeys !== 'object') {
    return null;
  }

  const keyName = provider === 'openrouter' ? 'openrouterApiKey' : 'geminiApiKey';
  const apiKey = savedKeys[keyName];
  return typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
}

function hasProviderSignal(provider, existingConfig = null, savedKeys = null) {
  if (getStoredApiKey(provider)) {
    return true;
  }

  if (getSavedApiKeyForProvider(savedKeys, provider)) {
    return true;
  }

  return Boolean(existingConfig?.auth?.profiles?.[PROVIDER_CONFIG[provider].profileId]);
}

async function getDesiredProviderState(existingConfig = null, options = {}) {
  const savedKeys = await getSavedKeys().catch(() => null);
  const explicitProvider = normalizeProvider(options.provider);
  const detectedProvider = detectProviderFromConfig(existingConfig || {});
  const hasOpenRouter = hasProviderSignal('openrouter', existingConfig, savedKeys);
  const hasGemini = hasProviderSignal('gemini', existingConfig, savedKeys);

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

async function reconcileOpenClawConfigState(options = {}) {
  const configPath = getOpenClawConfigPath();
  const result = {
    configPath,
    modelChanged: false,
    provider: null,
  };

  if (!fs.existsSync(configPath)) {
    throw new Error(`Khong tim thay file cau hinh OpenClaw: ${configPath}`);
  }

  const config = readJsonFile(configPath);
  const providerState = await getDesiredProviderState(config, options);
  const provider = providerState.primaryProvider;
  if (!provider) {
    return result;
  }

  const providerConfig = PROVIDER_CONFIG[provider];
  const currentDefaults = config.agents?.defaults || {};
  const currentPrimaryModel = currentDefaults.model?.primary || null;
  const currentModels = currentDefaults.models || {};
  const mergedModelEntries = providerState.modelProviders.reduce((entries, providerName) => {
    return {
      ...entries,
      ...PROVIDER_CONFIG[providerName].modelEntries,
    };
  }, {});
  const currentTelegramEnabled = config.channels?.telegram?.enabled === true;
  const currentTelegramBotToken = typeof config.channels?.telegram?.botToken === 'string'
    ? config.channels.telegram.botToken
    : null;
  const currentTelegramSendMessage = config.channels?.telegram?.actions?.sendMessage === true;
  const currentTelegramMediaMaxMb = config.channels?.telegram?.mediaMaxMb;
  const telegramBotToken = getStoredTelegramBotToken();
  const missingModelEntries = Object.entries(mergedModelEntries).some(([modelName, modelConfig]) => {
    if (!Object.prototype.hasOwnProperty.call(currentModels, modelName)) {
      return true;
    }

    const currentEntry = currentModels[modelName] || {};
    return Object.entries(modelConfig).some(([key, value]) => currentEntry[key] !== value);
  });

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

  if (providerState.authProviders.includes('gemini')) {
    config.plugins = config.plugins || {};
    config.plugins.entries = config.plugins.entries || {};
    config.plugins.entries.google = {
      ...(config.plugins.entries.google || {}),
      enabled: true,
    };
  }

  config.auth = config.auth || {};
  config.auth.profiles = config.auth.profiles || {};
  for (const providerName of providerState.authProviders) {
    const activeProviderConfig = PROVIDER_CONFIG[providerName];
    config.auth.profiles[activeProviderConfig.profileId] = {
      ...(config.auth.profiles[activeProviderConfig.profileId] || {}),
      provider: activeProviderConfig.provider,
      mode: 'api_key',
    };
  }

  const authProfilesPath = getOpenClawAgentAuthProfilesPath();
  const authProfiles = fs.existsSync(authProfilesPath)
    ? readJsonFile(authProfilesPath)
    : { version: 1, profiles: {}, lastGood: {} };

  authProfiles.version = 1;
  authProfiles.profiles = authProfiles.profiles || {};
  authProfiles.lastGood = authProfiles.lastGood || {};

  let authProfilesChanged = false;
  for (const providerName of providerState.authProviders) {
    const activeProviderConfig = PROVIDER_CONFIG[providerName];
    const apiKey = getSavedApiKeyForProvider(providerState.savedKeys, providerName) || getStoredApiKey(providerName);
    if (!apiKey) {
      continue;
    }

    const currentProfile = authProfiles.profiles[activeProviderConfig.profileId] || {};
    if (
      currentProfile.type !== 'api_key'
      || currentProfile.provider !== activeProviderConfig.provider
      || currentProfile.key !== apiKey
      || authProfiles.lastGood[activeProviderConfig.provider] !== activeProviderConfig.profileId
    ) {
      authProfiles.profiles[activeProviderConfig.profileId] = {
        type: 'api_key',
        provider: activeProviderConfig.provider,
        key: apiKey,
      };
      authProfiles.lastGood[activeProviderConfig.provider] = activeProviderConfig.profileId;
      authProfilesChanged = true;
    }
  }

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

  if (
    currentPrimaryModel !== providerConfig.model
    || missingModelEntries
    || currentTelegramEnabled !== Boolean(telegramBotToken)
    || (telegramBotToken && currentTelegramBotToken !== telegramBotToken)
    || currentTelegramSendMessage !== true
    || currentTelegramMediaMaxMb !== TELEGRAM_MEDIA_MAX_MB
    || providerState.authProviders.some((providerName) => {
      const activeProviderConfig = PROVIDER_CONFIG[providerName];
      return config.auth.profiles[activeProviderConfig.profileId].provider !== activeProviderConfig.provider
        || config.auth.profiles[activeProviderConfig.profileId].mode !== 'api_key';
    })
  ) {
    result.provider = provider;
    result.modelChanged = true;
    writeJsonFile(configPath, config);
  }

  if (authProfilesChanged) {
    writeJsonFile(authProfilesPath, authProfiles);
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
          .forEach(line => sendRendererLog(`[${logPrefix}] ${line}`));
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
          .forEach(line => sendRendererLog(`[${logPrefix} ERROR] ${line}`));
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

function openGatewayDashboard(force = false) {
  if (gatewayDashboardOpened && !force) {
    return;
  }

  gatewayDashboardOpened = true;
  shell.openExternal(gatewayDashboardUrl)
    .then(() => {
      sendRendererLog(`[Gateway] Da mo dashboard tai ${gatewayDashboardUrl}`);
    })
    .catch((error) => {
      gatewayDashboardOpened = false;
      console.error('[Gateway dashboard error]:', error);
      sendRendererLog(`[Gateway ERROR] Khong mo duoc dashboard: ${error.message}`);
    });
}

function scheduleGatewayDashboardRefresh() {
  if (gatewayDashboardRefreshTimer) {
    clearTimeout(gatewayDashboardRefreshTimer);
  }

  sendRendererLog('[Gateway] 15s nua app se mo lai web OpenClaw de refresh dashboard.');
  gatewayDashboardRefreshTimer = setTimeout(() => {
    gatewayDashboardRefreshTimer = null;
    sendRendererLog('[Gateway] Dang mo lai web OpenClaw sau 15s...');
    openGatewayDashboard(true);
  }, 15000);
}

function checkGatewayHttpReady() {
  return new Promise((resolve) => {
    const request = http.get(gatewayDashboardUrl, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on('error', () => {
      resolve(false);
    });

    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForGatewayHttpReady(timeoutMs = 30000, intervalMs = 1000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const isReady = await checkGatewayHttpReady();
    if (isReady) {
      gatewayReady = true;
      gatewayInfo = {
        ...gatewayInfo,
        url: gatewayInfo.url || 'ws://127.0.0.1:18789',
        pid: gatewayInfo.pid || gatewayProcess?.pid,
      };

      if (mainWindow?.webContents) {
        mainWindow.webContents.send('gateway-ready', gatewayInfo);
      }

      openGatewayDashboard();
      scheduleGatewayDashboardRefresh();
      return true;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  return false;
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

  sendRendererLog(`[Stop] Tim thay PID ngoai app: ${pids.join(', ')}`);

  const outputs = [];
  for (const pid of pids) {
    const command = `taskkill /PID ${pid} /T /F`;
    sendRendererLog(`[Stop] Dang dung PID ngoai app ${pid}`);

    const { stdout, stderr } = await runPowerShellCommand(command, {
      logPrefix: 'Stop',
      streamStdout: true,
      streamStderr: true,
    });

    outputs.push(stdout || stderr || `Da dung PID ${pid}`);
  }

  resetGatewayState();

  return {
    status: 'ok',
    message: outputs.join('\n'),
    details: {
      pids,
      scope: 'external-listener',
    },
  };
}

async function stopForegroundGatewayProcess() {
  const pid = gatewayProcess?.pid;

  if (!pid) {
    return stopExternalGatewayProcesses();
  }

  sendRendererLog(`[Stop] Dang dung tien trinh foreground PID ${pid}`);
  const command = `taskkill /PID ${pid} /T /F`;
  const { stdout, stderr } = await runPowerShellCommand(command, {
    logPrefix: 'Stop',
    streamStdout: true,
    streamStderr: true,
  });

  resetGatewayState();

  return {
    status: 'ok',
    message: stdout || stderr || `Da dung tien trinh foreground PID ${pid}`,
    details: {
      pid,
      command,
    },
  };
}

async function getAppState() {
  const installation = await detectOpenClawInstallation();
  const version = await getInstalledOpenClawVersion();
  const installed = Boolean(version || installation.commandExists || installation.configExists || installation.authExists);
  let savedKeys = await getSavedKeys();
  const hasSavedKeys = Object.values(savedKeys).some(value => typeof value === 'string' && value.trim());

  if (!hasSavedKeys) {
    const legacyKeys = {
      openrouterApiKey: getStoredApiKey('openrouter'),
      geminiApiKey: getStoredApiKey('gemini'),
      telegramBotToken: getStoredTelegramBotToken(),
    };
    const hasLegacyKeys = Object.values(legacyKeys).some(value => typeof value === 'string' && value.trim());
    if (hasLegacyKeys) {
      savedKeys = await saveKeys(legacyKeys);
    }
  }

  const gatewayPids = await getGatewayListenerPids().catch(() => []);
  const gatewayRunning = gatewayPids.length > 0;
  const gatewayHttpReady = gatewayRunning ? await checkGatewayHttpReady() : false;
  const telegramPairing = getTelegramPairingState();

  if (gatewayRunning) {
    gatewayReady = gatewayHttpReady;
    gatewayInfo = {
      ...gatewayInfo,
      url: 'ws://127.0.0.1:18789',
      pid: gatewayPids[0],
    };
  } else if (!gatewayProcess) {
    resetGatewayState();
  }

  return {
    installed,
    version: version || (installed ? 'installed' : null),
    gatewayRunning,
    gatewayReady: gatewayHttpReady,
    installation,
    savedKeys,
    telegramPairing,
    gatewayInfo: gatewayRunning
      ? {
          url: 'ws://127.0.0.1:18789',
          pid: gatewayPids[0],
        }
      : null,
  };
}

function createMainWindow() {
  console.log('[Main] Creating main window');
  console.log('[Main] __dirname:', __dirname);
  const appIconPath = path.join(__dirname, 'assets', 'openclaw.ico');
  
  const window = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: 'OpenClaw Controller',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const filePath = path.join(__dirname, 'index.html');
  console.log('[Main] Loading file:', filePath);

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => null);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url).catch(() => null);
    }
  });
  
  window.loadFile(filePath).catch(err => {
    console.error('[Main] Error loading file:', err);
  });

  window.once('ready-to-show', () => {
    console.log('[Main] Window ready to show');
    window.show();
    window.focus();
    window.moveTop();
  });

  window.webContents.on('did-finish-load', () => {
    console.log('[Main] WebContents did-finish-load');
    window.show();
    window.focus();
  });

  window.on('show', () => {
    console.log('[Main] Window shown');
  });

  window.webContents.on('crashed', () => {
    console.error('[Main] Renderer process crashed');
  });

  return window;
}

app.whenReady().then(() => {
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });

  // Start watching gateway log
  watchGatewayLog();
});

app.on('second-instance', () => {
  focusExistingMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (logicTaskProcess && !logicTaskProcess.killed) {
    logicTaskProcess.kill();
    logicTaskProcess = null;
  }
});

function watchGatewayLog() {
  const logDir = path.join(process.env.LOCALAPPDATA || process.env.HOME, 'Temp/openclaw');
  const findLatestLog = () => {
    try {
      if (!fs.existsSync(logDir)) return null;
      const files = fs.readdirSync(logDir)
        .filter(f => f.startsWith('openclaw-') && f.endsWith('.log'))
        .sort()
        .reverse();
      return files.length > 0 ? path.join(logDir, files[0]) : null;
    } catch (err) {
      return null;
    }
  };

  let lastSize = 0;
  let lastLogFile = findLatestLog();

  const checkLog = () => {
    const currentLogFile = findLatestLog();
    
    if (currentLogFile && currentLogFile === lastLogFile) {
      try {
        const stat = fs.statSync(currentLogFile);
        if (stat.size > lastSize) {
          const newContent = fs.readFileSync(currentLogFile, 'utf8').slice(lastSize);
          lastSize = stat.size;
          if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('gateway-log', newContent.trim().split('\n').pop());
          }
        }
      } catch (err) {
        // Ignore
      }
    } else if (currentLogFile && currentLogFile !== lastLogFile) {
      lastLogFile = currentLogFile;
      lastSize = 0;
    }
  };

  setInterval(checkLog, 1000);
}

ipcMain.handle('openclaw:command', async (_event, command, params) => {
  console.log('OpenClaw command:', command, params);
  
  try {
    if (command === 'run-gateway') {
      if (hasActiveLogicTask()) {
        return {
          status: 'error',
          message: 'Dang co tac vu cai dat/go bo chay nen chua the bat gateway',
          details: null,
        };
      }

      const reconciled = await reconcileOpenClawConfigState();
      if (reconciled.modelChanged) {
        sendRendererLog(`[Gateway] Da dong bo config theo provider ${reconciled.provider}`);
      }

      if (await checkGatewayHttpReady()) {
        gatewayReady = true;
        gatewayInfo = {
          ...gatewayInfo,
          url: gatewayInfo.url || 'ws://127.0.0.1:18789',
          pid: gatewayInfo.pid || gatewayProcess?.pid,
        };
        if (mainWindow?.webContents) {
          mainWindow.webContents.send('gateway-ready', gatewayInfo);
        }

        openGatewayDashboard();
        scheduleGatewayDashboardRefresh();
        return {
          status: 'ok',
          message: 'OpenClaw gateway da san sang, da mo dashboard',
          details: { pid: gatewayProcess?.pid, dashboardUrl: gatewayDashboardUrl },
        };
      }

      if (gatewayReady) {
        openGatewayDashboard();
        scheduleGatewayDashboardRefresh();
        return {
          status: 'ok',
          message: 'OpenClaw gateway dang chay, da mo dashboard',
          details: { pid: gatewayProcess?.pid, dashboardUrl: gatewayDashboardUrl },
        };
      }

      if (!gatewayProcess) {
        console.log('[Gateway] Starting gateway process...');
        try {
          const gatewayRunCommand = 'openclaw gateway run --allow-unconfigured --force --auth none';

          // Run OpenClaw gateway in the foreground so the app can manage its lifecycle.
          gatewayProcess = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', gatewayRunCommand], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            shell: false,
          });

          sendRendererLog(`[Gateway] Dang chay lenh: ${gatewayRunCommand}`);

          gatewayProcess.stdout?.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) {
              console.log('[Gateway output]:', msg);
              if (mainWindow?.webContents) {
                mainWindow.webContents.send('gateway-log', msg);
              }
              
              // Detect when gateway is ready by looking for "listening on ws://"
              if (!gatewayReady && msg.includes('listening on ws://')) {
                gatewayReady = true;
                // Extract URL and PID from message
                const urlMatch = msg.match(/ws:\/\/([^,\s]+)/);
                const pidMatch = msg.match(/PID\s+(\d+)/);
                
                gatewayInfo = {
                  url: urlMatch ? `ws://${urlMatch[1]}` : 'ws://127.0.0.1:18789',
                  pid: pidMatch ? pidMatch[1] : gatewayProcess.pid,
                };

                console.log('[Gateway Ready]', gatewayInfo);
                if (mainWindow?.webContents) {
                  mainWindow.webContents.send('gateway-ready', gatewayInfo);
                }
                openGatewayDashboard();
                scheduleGatewayDashboardRefresh();
              }
            }
          });

          gatewayProcess.stderr?.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) {
              console.error('[Gateway error]:', msg);
              if (mainWindow?.webContents) {
                const hint = msg.includes('Missing config')
                  ? `${msg} App dang cho phep gateway chay khong can config, hay thu lai neu day la log cu.`
                  : msg.includes('device token mismatch') || msg.includes('pairing required') || msg.includes('too many failed authentication attempts')
                    ? `${msg} Gateway local dang duoc chuyen sang auth none, hay thu chay lai gateway de reset phien xac thuc cu.`
                  : msg;
                mainWindow.webContents.send('gateway-log', `[ERROR] ${hint}`);
              }
            }
          });

          gatewayProcess.on('close', (code) => {
            console.log('[Gateway] Process exited with code:', code);
            resetGatewayState();
          });

          gatewayProcess.on('error', (err) => {
            console.error('[Gateway spawn error]:', err);
            if (mainWindow?.webContents) {
              mainWindow.webContents.send('gateway-log', `[ERROR] Failed to start gateway: ${err.message}`);
            }
            resetGatewayState();
          });
        } catch (spawnErr) {
          console.error('[Gateway spawn exception]:', spawnErr);
          if (mainWindow?.webContents) {
            mainWindow.webContents.send('gateway-log', `[ERROR] Failed to spawn gateway: ${spawnErr.message}`);
          }
          resetGatewayState();
          return { status: 'error', message: `Failed to start gateway: ${spawnErr.message}`, details: null };
        }

        void waitForGatewayHttpReady().then((isReady) => {
          if (!isReady) {
            sendRendererLog('[Gateway ERROR] Gateway khong san sang trong thoi gian cho phep.');
          }
        });
      }
      return {
        status: 'ok',
        message: 'OpenClaw gateway dang khoi dong, se mo dashboard khi san sang',
        details: { pid: gatewayProcess?.pid, dashboardUrl: gatewayDashboardUrl },
      };
    }

    if (command === 'install') {
      const provider = resolveInstallProvider(params);
      const installParams = {
        provider,
        openrouterApiKey: String(params?.openrouterApiKey || '').trim(),
        geminiApiKey: String(params?.geminiApiKey || '').trim(),
        telegramBotToken: String(params?.telegramBotToken || '').trim(),
      };

      if (!installParams.provider) {
        throw new Error('Cần nhập OpenRouter API key hoặc Gemini API key trước khi cài OpenClaw.');
      }

      if (gatewayProcess?.pid) {
        try {
          await stopForegroundGatewayProcess();
        } catch (stopError) {
          sendRendererLog(`[Install] Khong the dung gateway truoc khi cai: ${stopError.message}`);
        }
      }

      return runLogicTask('install', installParams);
    }

    if (command === 'save-keys') {
      const saveParams = {
        provider: resolveInstallProvider(params),
        openrouterApiKey: String(params?.openrouterApiKey || '').trim(),
        geminiApiKey: String(params?.geminiApiKey || '').trim(),
        telegramBotToken: String(params?.telegramBotToken || '').trim(),
      };

      if (!saveParams.openrouterApiKey && !saveParams.geminiApiKey && !saveParams.telegramBotToken) {
        throw new Error('Cần nhập ít nhất một key OpenRouter, Gemini hoặc Telegram trước khi lưu.');
      }

      return runLogicTask('save-keys', saveParams);
    }

    if (command === 'connect-telegram') {
      const connectParams = {
        pairingCode: String(params?.pairingCode || '').trim(),
      };

      return runLogicTask('connect-telegram', connectParams);
    }

    if (command === 'set-full-rights') {
      if (gatewayProcess?.pid) {
        try {
          await stopForegroundGatewayProcess()
        } catch (stopError) {
          sendRendererLog(`[Full Rights] Khong the dung gateway truoc khi set full quyen: ${stopError.message}`);
        }
      }

      resetGatewayState();
      return runLogicTask('set-full-rights', {});
    }

    if (command === 'restart') {
      if (gatewayProcess) {
        gatewayProcess.kill('SIGTERM');
        resetGatewayState();
      }
      return { status: 'ok', message: 'OpenClaw restarting', details: params };
    }

    if (command === 'uninstall') {
      console.log('[Uninstall] Starting uninstall process...');

      if (gatewayProcess?.pid) {
        try {
          await stopForegroundGatewayProcess();
        } catch (stopError) {
          sendRendererLog(`[Uninstall] Khong the dung gateway truoc khi go: ${stopError.message}`);
        }
      }

      resetGatewayState();
      return runLogicTask('uninstall', {});
    }

    if (command === 'stop') {
      return stopForegroundGatewayProcess();
    }

    // Handle other commands (open, close, stop, etc.)
    switch (command) {
      case 'open':
        return { status: 'ok', message: 'OpenClaw opening', details: params };
      case 'close':
        return { status: 'ok', message: 'OpenClaw closing', details: params };
      default:
        return { status: 'error', message: `Unknown OpenClaw command: ${command}`, details: params };
    }
  } catch (error) {
    console.error('[Error]', error);
    return { status: 'error', message: error.message, details: null };
  }
});

ipcMain.handle('openclaw:get-app-state', async () => {
  return getAppState();
});
