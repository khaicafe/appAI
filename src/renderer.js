const statusElement = document.getElementById('status');
const logElement = document.getElementById('log');
const logSection = document.getElementById('logSection');
const configTabButton = document.getElementById('configTabButton');
const controllerTabButton = document.getElementById('controllerTabButton');
const guideTabButton = document.getElementById('guideTabButton');
const configTabPanel = document.getElementById('configTabPanel');
const controllerTabPanel = document.getElementById('controllerTabPanel');
const guideTabPanel = document.getElementById('guideTabPanel');
const telegramConnectPanel = document.getElementById('telegramConnectPanel');
const telegramPairingFields = document.getElementById('telegramPairingFields');
const telegramPairingStatus = document.getElementById('telegramPairingStatus');
const openrouterApiKeyInput = document.getElementById('openrouterApiKey');
const geminiApiKeyInput = document.getElementById('geminiApiKey');
const telegramBotTokenInput = document.getElementById('telegramBotToken');
const telegramPairingCodeInput = document.getElementById('telegramPairingCode');
const openrouterKeyStatus = document.getElementById('openrouterKeyStatus');
const geminiKeyStatus = document.getElementById('geminiKeyStatus');
const telegramKeyStatus = document.getElementById('telegramKeyStatus');
const buttonStates = {
  stop: {
    button: document.getElementById('stopButton'),
    label: document.getElementById('stopButtonLabel'),
    idleText: 'Dừng',
    loadingText: 'Đang dừng',
  },
  'run-gateway': {
    button: document.getElementById('runGatewayButton'),
    label: document.getElementById('runGatewayButtonLabel'),
    idleText: 'Chạy Gateway',
    loadingText: 'Đang chạy gateway',
  },
  install: {
    button: document.getElementById('installButton'),
    label: document.getElementById('installButtonLabel'),
    idleText: 'Cài đặt OpenClaw',
    loadingText: 'Đang cài đặt',
    disableGeminiInput: true,
  },
  'save-keys': {
    button: document.getElementById('saveKeysButton'),
    label: document.getElementById('saveKeysButtonLabel'),
    idleText: 'Lưu key',
    loadingText: 'Đang lưu key',
    disableGeminiInput: true,
  },
  'connect-telegram': {
    button: document.getElementById('connectTelegramButton'),
    label: document.getElementById('connectTelegramButtonLabel'),
    idleText: 'Connect Telegram',
    loadingText: 'Đang connect Telegram',
    disableGeminiInput: true,
  },
  'set-full-rights': {
    button: document.getElementById('setFullRightsButton'),
    label: document.getElementById('setFullRightsButtonLabel'),
    idleText: 'Set Full Quyền',
    loadingText: 'Đang set full quyền',
  },
  uninstall: {
    button: document.getElementById('uninstallButton'),
    label: document.getElementById('uninstallButtonLabel'),
    idleText: 'Gỡ bỏ OpenClaw',
    loadingText: 'Đang gỡ',
  },
};
const activeCommands = new Set();
let logicTaskBusy = false;
let gatewayRunning = false;
let openclawInstalled = false;
let telegramPairingMode = false;
let savedKeysState = {};

function applyTelegramPairingState(pairingState = {}) {
  if (!telegramPairingStatus) {
    return;
  }

  const status = pairingState?.status || 'unpaired';
  telegramPairingStatus.textContent = pairingState?.message || 'Telegram chưa pair. Hãy nhắn bot để lấy pairing code mới.';
  telegramPairingStatus.classList.remove('is-success', 'is-warning', 'is-info');

  if (status === 'paired' || status === 'paired-with-pending') {
    telegramPairingStatus.classList.add('is-success');
    return;
  }

  if (status === 'pending') {
    telegramPairingStatus.classList.add('is-warning');
    return;
  }

  telegramPairingStatus.classList.add('is-info');
}

function setOpenClawInstalledState(isInstalled) {
  openclawInstalled = Boolean(isInstalled);
  if (!openclawInstalled) {
    telegramPairingMode = false;
    telegramPairingCodeInput.value = '';
  }

  syncButtonAvailability();
}

function getCommandIdleText(command) {
  if (command === 'connect-telegram') {
    return telegramPairingMode ? 'Xác nhận Pairing Telegram' : 'Connect Telegram';
  }

  return buttonStates[command]?.idleText || '';
}

function setActiveTab(tabName) {
  const tabMap = {
    controller: {
      button: controllerTabButton,
      panel: controllerTabPanel,
    },
    config: {
      button: configTabButton,
      panel: configTabPanel,
    },
    guide: {
      button: guideTabButton,
      panel: guideTabPanel,
    },
  };

  for (const [name, tab] of Object.entries(tabMap)) {
    const isActive = name === tabName;
    tab.button.classList.toggle('is-active', isActive);
    tab.button.setAttribute('aria-selected', String(isActive));
    tab.panel.classList.toggle('is-active', isActive);
  }

  if (logSection) {
    logSection.hidden = tabName === 'guide';
  }
}

function syncButtonAvailability() {
  for (const [command, state] of Object.entries(buttonStates)) {
    const isCommandBusy = activeCommands.has(command);
    state.button.disabled = logicTaskBusy || isCommandBusy;
    if (!isCommandBusy) {
      state.label.textContent = getCommandIdleText(command);
    }
  }

  buttonStates['connect-telegram'].button.disabled = logicTaskBusy || activeCommands.has('connect-telegram') || !openclawInstalled;
  buttonStates['set-full-rights'].button.disabled = logicTaskBusy || activeCommands.has('set-full-rights') || !openclawInstalled;
  telegramPairingCodeInput.disabled = logicTaskBusy || activeCommands.has('connect-telegram') || !telegramPairingMode;
  telegramConnectPanel.hidden = !openclawInstalled;
  telegramPairingFields.hidden = !telegramPairingMode;

  if (!activeCommands.has('install')) {
    syncProviderInputs();
  }
}

function setCommandLoadingState(command, isLoading) {
  const state = buttonStates[command];
  if (!state) {
    return;
  }

  if (isLoading) {
    activeCommands.add(command);
  } else {
    activeCommands.delete(command);
  }

  syncButtonAvailability();
  state.button.classList.toggle('is-loading', isLoading);
  state.label.textContent = isLoading ? state.loadingText : getCommandIdleText(command);

  if (state.disableGeminiInput) {
    syncProviderInputs();
  }
}

function appendLog(text) {
  if (logElement.textContent) {
    logElement.textContent += '\n';
  }

  logElement.textContent += text;
  logElement.scrollTop = logElement.scrollHeight;
}

function syncProviderInputs() {
  const installBusy = logicTaskBusy || activeCommands.has('install');

  openrouterApiKeyInput.disabled = installBusy;
  geminiApiKeyInput.disabled = installBusy;
  telegramBotTokenInput.disabled = installBusy;
}

function getKeyParams() {
  const openrouterApiKey = openrouterApiKeyInput.value.trim();
  const geminiApiKey = geminiApiKeyInput.value.trim();

  return {
    openrouterApiKey,
    geminiApiKey,
    telegramBotToken: telegramBotTokenInput.value.trim(),
  };
}

function getValidatedInstallParams() {
  const { openrouterApiKey, geminiApiKey, telegramBotToken } = getKeyParams();
  const effectiveOpenRouterKey = openrouterApiKey || String(savedKeysState?.openrouterApiKey || '').trim();
  const effectiveGeminiKey = geminiApiKey || String(savedKeysState?.geminiApiKey || '').trim();

  if (!effectiveOpenRouterKey && !effectiveGeminiKey) {
    statusElement.textContent = 'Cần có OpenRouter hoặc Gemini API key';
    appendLog(`[${new Date().toLocaleTimeString()}] install: Cần có ít nhất một key OpenRouter hoặc Gemini trong input hoặc key đã lưu trước khi cài OpenClaw.`);
    openrouterApiKeyInput.focus();
    return null;
  }

  return {
    openrouterApiKey,
    geminiApiKey,
    telegramBotToken,
  };
}

function getValidatedTelegramPairingParams() {
  const pairingCode = telegramPairingCodeInput.value.trim();
  if (!pairingCode) {
    statusElement.textContent = 'Cần nhập Telegram pairing code';
    appendLog(`[${new Date().toLocaleTimeString()}] connect-telegram: Cần nhập Telegram pairing code trước khi approve.`);
    telegramPairingCodeInput.focus();
    return null;
  }

  return { pairingCode };
}

function setKeyStatusBadge(element, hasValue) {
  element.textContent = hasValue ? 'Đã có' : 'Chưa có';
  element.classList.toggle('is-present', hasValue);
}

function updateSavedKeyStatus(savedKeys = {}) {
  setKeyStatusBadge(openrouterKeyStatus, Boolean(savedKeys.openrouterApiKey && savedKeys.openrouterApiKey.trim()));
  setKeyStatusBadge(geminiKeyStatus, Boolean(savedKeys.geminiApiKey && savedKeys.geminiApiKey.trim()));
  setKeyStatusBadge(telegramKeyStatus, Boolean(savedKeys.telegramBotToken && savedKeys.telegramBotToken.trim()));
}

function applySavedKeys(savedKeys = {}) {
  savedKeysState = {
    ...savedKeysState,
    ...savedKeys,
  };

  if (typeof savedKeys.openrouterApiKey === 'string' && savedKeys.openrouterApiKey.trim()) {
    openrouterApiKeyInput.value = savedKeys.openrouterApiKey.trim();
  }

  if (typeof savedKeys.geminiApiKey === 'string' && savedKeys.geminiApiKey.trim()) {
    geminiApiKeyInput.value = savedKeys.geminiApiKey.trim();
  }

  if (typeof savedKeys.telegramBotToken === 'string' && savedKeys.telegramBotToken.trim()) {
    telegramBotTokenInput.value = savedKeys.telegramBotToken.trim();
  }

  updateSavedKeyStatus(savedKeys);
}

function applyStartupState(state) {
  const gatewayInfoElement = document.getElementById('gatewayInfo');
  const gatewayUrl = document.getElementById('gatewayUrl');
  const gatewayPid = document.getElementById('gatewayPid');
  const versionLabel = state?.version && state.version !== 'installed'
    ? `OpenClaw đã cài (${state.version})`
    : 'OpenClaw đã cài';

  applySavedKeys(state?.savedKeys || {});
  applyTelegramPairingState(state?.telegramPairing || {});
  setOpenClawInstalledState(state?.installed);
  gatewayRunning = Boolean(state?.gatewayRunning);
  syncButtonAvailability();

  if (!state?.installed) {
    statusElement.textContent = 'OpenClaw chưa được cài đặt';
    appendLog(`[${new Date().toLocaleTimeString()}] startup: Chưa tìm thấy OpenClaw trong máy.`);
    gatewayInfoElement.style.display = 'none';
    return;
  }

  if (state.gatewayRunning) {
    statusElement.textContent = `${versionLabel}, gateway đang chạy`;
    gatewayUrl.textContent = `🔗 URL: ${state.gatewayInfo?.url || 'ws://127.0.0.1:18789'}`;
    gatewayPid.textContent = `⚙️ PID: ${state.gatewayInfo?.pid || 'N/A'}`;
    gatewayInfoElement.style.display = 'block';
    appendLog(`[${new Date().toLocaleTimeString()}] startup: ${versionLabel}, gateway đang chạy.`);
    return;
  }

  statusElement.textContent = `${versionLabel}, gateway đang dừng`;
  gatewayInfoElement.style.display = 'none';
  appendLog(`[${new Date().toLocaleTimeString()}] startup: ${versionLabel}, gateway đang dừng.`);
}

async function initializeAppState() {
  try {
    const state = await window.openclaw.getAppState();
    applyStartupState(state);
  } catch (error) {
    appendLog(`[${new Date().toLocaleTimeString()}] startup lỗi: ${error.message || error}`);
    statusElement.textContent = 'Không kiểm tra được trạng thái OpenClaw';
  }
}

async function sendOpenClawCommand(command, params = {}) {
  if (activeCommands.has(command)) {
    return;
  }

  setCommandLoadingState(command, true);

  statusElement.textContent = `Đang gửi: ${command}...`;
  try {
    const result = await window.openclaw.sendCommand(command, params);
    if (command === 'save-keys') {
      applySavedKeys(params);
    }
    if (command === 'install' && result?.status === 'ok') {
      setOpenClawInstalledState(true);
      setActiveTab('controller');
      telegramConnectPanel.hidden = false;
      void initializeAppState();
    }
    if (command === 'connect-telegram' && result?.status === 'ok') {
      const requiresPairingCode = result?.details?.requiresPairingCode === true;
      telegramPairingMode = requiresPairingCode;
      if (!requiresPairingCode) {
        telegramPairingCodeInput.value = '';
      }

      if (result?.details?.rawOutput) {
        appendLog(`[${new Date().toLocaleTimeString()}] pairing-list: ${result.details.rawOutput}`);
      }

      syncButtonAvailability();
      if (telegramPairingMode) {
        telegramPairingCodeInput.focus();
      }

      void initializeAppState();
    }
    if (command === 'set-full-rights' && result?.status === 'ok') {
      gatewayRunning = false;
      syncButtonAvailability();
      void initializeAppState();
    }
    if ((command === 'stop' || command === 'uninstall') && result?.status === 'ok') {
      gatewayRunning = false;
      if (command === 'uninstall') {
        setOpenClawInstalledState(false);
      }
      syncButtonAvailability();
    }
    appendLog(
      `[${new Date().toLocaleTimeString()}] ${command}: ${result.message || JSON.stringify(result)}`,
    );
    statusElement.textContent = result?.message || `Lệnh ${command} đã gửi`;
  } catch (error) {
    const errorMessage = error?.message || String(error);
    appendLog(`[${new Date().toLocaleTimeString()}] lỗi: ${errorMessage}`);
    statusElement.textContent = command === 'connect-telegram'
      ? errorMessage
      : 'Lỗi khi gửi lệnh';
  } finally {
    setCommandLoadingState(command, false);
  }
}

buttonStates.stop.button.addEventListener('click', () => {
  sendOpenClawCommand('stop');
});

buttonStates['run-gateway'].button.addEventListener('click', () => {
  sendOpenClawCommand('run-gateway', {});
});

buttonStates.install.button.addEventListener('click', () => {
  const installParams = getValidatedInstallParams();
  if (!installParams) {
    setActiveTab('config');
    return;
  }

  setActiveTab('controller');
  sendOpenClawCommand('install', installParams);
});

buttonStates['save-keys'].button.addEventListener('click', () => {
  const saveParams = getKeyParams();
  if (!saveParams.openrouterApiKey && !saveParams.geminiApiKey && !saveParams.telegramBotToken) {
    statusElement.textContent = 'Cần nhập ít nhất một key để lưu';
    appendLog(`[${new Date().toLocaleTimeString()}] save-keys: Cần nhập ít nhất một key OpenRouter, Gemini hoặc Telegram trước khi lưu.`);
    setActiveTab('config');
    openrouterApiKeyInput.focus();
    return;
  }

  setActiveTab('config');
  sendOpenClawCommand('save-keys', saveParams);
});

buttonStates['connect-telegram'].button.addEventListener('click', () => {
  if (!openclawInstalled) {
    statusElement.textContent = 'Cần cài OpenClaw trước khi connect Telegram';
    appendLog(`[${new Date().toLocaleTimeString()}] connect-telegram: Chưa thể connect Telegram khi OpenClaw chưa được cài.`);
    return;
  }

  if (!telegramPairingMode) {
    setActiveTab('controller');
    sendOpenClawCommand('connect-telegram', {});
    return;
  }

  if (!gatewayRunning) {
    statusElement.textContent = 'Cần chạy Gateway trước khi approve Telegram pairing code';
    appendLog(`[${new Date().toLocaleTimeString()}] connect-telegram: Hãy chạy Gateway rồi nhập pairing code để approve.`);
    return;
  }

  const connectParams = getValidatedTelegramPairingParams();
  if (!connectParams) {
    setActiveTab('controller');
    return;
  }

  setActiveTab('controller');
  sendOpenClawCommand('connect-telegram', connectParams);
});

buttonStates['set-full-rights'].button.addEventListener('click', () => {
  if (!openclawInstalled) {
    statusElement.textContent = 'Cần cài OpenClaw trước khi set full quyền';
    appendLog(`[${new Date().toLocaleTimeString()}] set-full-rights: Chưa thể set full quyền khi OpenClaw chưa được cài.`);
    return;
  }

  setActiveTab('controller');
  sendOpenClawCommand('set-full-rights', {});
});

buttonStates.uninstall.button.addEventListener('click', () => {
  if (confirm('Bạn chắc chắn muốn gỡ bỏ OpenClaw?')) {
    sendOpenClawCommand('uninstall', {});
  }
});

configTabButton.addEventListener('click', () => {
  setActiveTab('config');
});

controllerTabButton.addEventListener('click', () => {
  setActiveTab('controller');
});

guideTabButton.addEventListener('click', () => {
  setActiveTab('guide');
});

appendLog('Ứng dụng OpenClaw Controller đã khởi tạo.');

// Listen for gateway log updates
if (window.openclaw && window.openclaw.onGatewayLog) {
  window.openclaw.onGatewayLog((message) => {
    appendLog(message);
  });
}

// Listen for gateway ready event
if (window.openclaw && window.openclaw.onGatewayReady) {
  window.openclaw.onGatewayReady((info) => {
    const gatewayInfo = document.getElementById('gatewayInfo');
    const gatewayUrl = document.getElementById('gatewayUrl');
    const gatewayPid = document.getElementById('gatewayPid');

    if (info) {
      gatewayRunning = true;
      syncButtonAvailability();
      gatewayUrl.textContent = `🔗 URL: ${info.url || 'N/A'}`;
      gatewayPid.textContent = `⚙️ PID: ${info.pid || 'N/A'}`;
      gatewayInfo.style.display = 'block';
      statusElement.textContent = 'Gateway đã sẵn sàng';
      appendLog(`[Gateway Ready] Connected at ${info.url}`);
    }
  });
}

if (window.openclaw && window.openclaw.onLogicTaskState) {
  window.openclaw.onLogicTaskState((state) => {
    logicTaskBusy = Boolean(state?.busy);
    syncButtonAvailability();
  });
}

syncProviderInputs();
setActiveTab('controller');
void initializeAppState();
