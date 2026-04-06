const statusElement = document.getElementById('status');
const logElement = document.getElementById('log');
const logSection = document.getElementById('logSection');
const chatTabButton = document.getElementById('chatTabButton');
const configTabButton = document.getElementById('configTabButton');
const controllerTabButton = document.getElementById('controllerTabButton');
const modelTabButton = document.getElementById('modelTabButton');
const guideTabButton = document.getElementById('guideTabButton');
const chatTabPanel = document.getElementById('chatTabPanel');
const configTabPanel = document.getElementById('configTabPanel');
const controllerTabPanel = document.getElementById('controllerTabPanel');
const modelTabPanel = document.getElementById('modelTabPanel');
const guideTabPanel = document.getElementById('guideTabPanel');
const chatFrameShell = document.querySelector('.chat-frame-shell');
const openclawChatHost = document.getElementById('openclawChatHost');
const chatPlaceholder = document.getElementById('chatPlaceholder');
const chatPlaceholderMessage = document.getElementById('chatPlaceholderMessage');
const reloadChatButton = document.getElementById('reloadChatButton');
const openChatExternallyButton = document.getElementById('openChatExternallyButton');
const chatRunGatewayButton = document.getElementById('chatRunGatewayButton');
const telegramConnectPanel = document.getElementById('telegramConnectPanel');
const telegramPairingFields = document.getElementById('telegramPairingFields');
const telegramPairingStatus = document.getElementById('telegramPairingStatus');
const defaultModelSelect = document.getElementById('defaultModelSelect');
const currentModelLabel = document.getElementById('currentModelLabel');
const currentModelProvider = document.getElementById('currentModelProvider');
const modelWarning = document.getElementById('modelWarning');
const modelEmptyState = document.getElementById('modelEmptyState');
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
  'refresh-models': {
    button: document.getElementById('refreshModelsButton'),
    label: document.getElementById('refreshModelsButtonLabel'),
    idleText: 'Tải lại danh sách',
    loadingText: 'Đang tải model',
  },
  'set-default-model': {
    button: document.getElementById('setDefaultModelButton'),
    label: document.getElementById('setDefaultModelButtonLabel'),
    idleText: 'Đặt model mặc định',
    loadingText: 'Đang lưu model',
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
let modelState = {
  primaryModel: null,
  models: [],
  warning: null,
};
const chatDashboardUrl = 'http://localhost:18789/';
let chatLoadError = null;
let activeTab = 'controller';

function getChatHostBounds() {
  const target = chatFrameShell || openclawChatHost;
  if (!target) {
    return null;
  }

  const rect = target.getBoundingClientRect();
  const width = Math.max(0, Math.round(rect.width));
  const height = Math.max(0, Math.round(rect.height));
  if (width === 0 || height === 0) {
    return null;
  }

  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width,
    height,
  };
}

async function syncEmbeddedChat(forceReload = false) {
  if (activeTab !== 'chat' || !openclawInstalled || !gatewayRunning) {
    await window.openclaw.hideEmbeddedChat().catch(() => null);
    return;
  }

  const bounds = getChatHostBounds();
  if (!bounds) {
    return;
  }

  try {
    await window.openclaw.showEmbeddedChat(bounds, { forceReload });
    chatLoadError = null;
  } catch (error) {
    chatLoadError = error?.message || String(error);
  }

  updateChatVisibility();
}

function updateChatVisibility() {
  const canShowFrame = activeTab === 'chat' && openclawInstalled && gatewayRunning && !chatLoadError;
  if (openclawChatHost) {
    openclawChatHost.style.visibility = canShowFrame ? 'visible' : 'hidden';
  }

  if (!chatPlaceholder) {
    return;
  }

  chatPlaceholder.hidden = canShowFrame;

  if (!openclawInstalled) {
    chatPlaceholderMessage.textContent = 'Cần cài OpenClaw trước khi mở màn chat trong app.';
    return;
  }

  if (!gatewayRunning) {
    chatPlaceholderMessage.textContent = 'Hãy chạy Gateway để mở màn chat OpenClaw ngay trong app.';
    return;
  }

  if (chatLoadError) {
    chatPlaceholder.hidden = false;
    chatPlaceholderMessage.textContent = `Không tải được chat OpenClaw trong app: ${chatLoadError}`;
    return;
  }

  chatPlaceholderMessage.textContent = 'Đang tải màn chat OpenClaw...';
}

function refreshChatFrame(force = false) {
  if (!openclawChatHost) {
    return;
  }

  updateChatVisibility();
  if (!openclawInstalled || !gatewayRunning) {
    chatLoadError = null;
    void window.openclaw.hideEmbeddedChat().catch(() => null);
    return;
  }

  chatLoadError = null;
  void syncEmbeddedChat(force);
}

function getProviderLabel(provider) {
  if (!provider) {
    return 'N/A';
  }

  if (provider === 'openrouter') {
    return 'OpenRouter';
  }

  if (provider === 'gemini') {
    return 'Gemini';
  }

  return 'Khác';
}

function detectProviderFromModel(modelName) {
  const normalizedModelName = String(modelName || '').trim().toLowerCase();
  if (!normalizedModelName) {
    return null;
  }

  if (normalizedModelName.startsWith('openrouter/')) {
    return 'openrouter';
  }

  if (normalizedModelName.startsWith('google/') || normalizedModelName.startsWith('gemini')) {
    return 'gemini';
  }

  return null;
}

function renderModelOptions() {
  const models = Array.isArray(modelState.models) ? modelState.models : [];
  defaultModelSelect.innerHTML = '';

  if (models.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = openclawInstalled ? 'Chưa có model nào trong OpenClaw config' : 'Cần cài OpenClaw trước';
    defaultModelSelect.append(option);
    defaultModelSelect.value = '';
    modelEmptyState.hidden = false;
    return;
  }

  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.name;
    const providerLabel = getProviderLabel(model.provider);
    option.textContent = model.alias ? `${model.alias} (${model.name})` : `${model.name} (${providerLabel})`;
    defaultModelSelect.append(option);
  }

  modelEmptyState.hidden = true;
  defaultModelSelect.value = modelState.primaryModel && models.some((model) => model.name === modelState.primaryModel)
    ? modelState.primaryModel
    : models[0].name;
}

function applyModelState(nextState = {}) {
  modelState = {
    primaryModel: typeof nextState.primaryModel === 'string' ? nextState.primaryModel : null,
    models: Array.isArray(nextState.models) ? nextState.models : [],
    warning: typeof nextState.warning === 'string' && nextState.warning.trim() ? nextState.warning.trim() : null,
  };

  renderModelOptions();

  currentModelLabel.textContent = modelState.primaryModel || 'Chưa có';
  currentModelProvider.textContent = `Provider: ${getProviderLabel(detectProviderFromModel(modelState.primaryModel))}`;
  modelWarning.hidden = !modelState.warning;
  modelWarning.textContent = modelState.warning || '';
  syncButtonAvailability();
}

async function refreshModelState() {
  if (!openclawInstalled || activeCommands.has('refresh-models')) {
    return;
  }

  setCommandLoadingState('refresh-models', true);
  try {
    const nextState = await window.openclaw.getModelState();
    applyModelState(nextState);
    appendLog(`[${new Date().toLocaleTimeString()}] get-models: Đã tải ${modelState.models.length} model từ OpenClaw.`);
    statusElement.textContent = modelState.primaryModel
      ? `Model mặc định hiện tại: ${modelState.primaryModel}`
      : 'Đã tải danh sách model OpenClaw';
  } catch (error) {
    const errorMessage = error?.message || String(error);
    appendLog(`[${new Date().toLocaleTimeString()}] lỗi model: ${errorMessage}`);
    statusElement.textContent = 'Không tải được danh sách model';
  } finally {
    setCommandLoadingState('refresh-models', false);
  }
}

async function saveDefaultModelSelection() {
  if (!openclawInstalled || activeCommands.has('set-default-model')) {
    return;
  }

  const modelName = defaultModelSelect.value;
  if (!modelName) {
    statusElement.textContent = 'Cần chọn một model trước khi lưu';
    appendLog(`[${new Date().toLocaleTimeString()}] set-default-model: Chưa chọn model để đặt mặc định.`);
    return;
  }

  setCommandLoadingState('set-default-model', true);
  try {
    const result = await window.openclaw.setDefaultModel(modelName);
    applyModelState(result?.state || {});
    appendLog(`[${new Date().toLocaleTimeString()}] set-default-model: ${result?.message || modelName}`);
    statusElement.textContent = result?.message || `Đã đặt model mặc định: ${modelName}`;
  } catch (error) {
    const errorMessage = error?.message || String(error);
    appendLog(`[${new Date().toLocaleTimeString()}] lỗi model: ${errorMessage}`);
    statusElement.textContent = 'Không đặt được model mặc định';
  } finally {
    setCommandLoadingState('set-default-model', false);
  }
}

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
  activeTab = tabName;
  const tabMap = {
    chat: {
      button: chatTabButton,
      panel: chatTabPanel,
    },
    controller: {
      button: controllerTabButton,
      panel: controllerTabPanel,
    },
    config: {
      button: configTabButton,
      panel: configTabPanel,
    },
    model: {
      button: modelTabButton,
      panel: modelTabPanel,
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
    logSection.hidden = tabName !== 'controller';
  }

  if (tabName === 'chat') {
    refreshChatFrame();
  } else {
    void window.openclaw.hideEmbeddedChat().catch(() => null);
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
  buttonStates['refresh-models'].button.disabled = logicTaskBusy || activeCommands.has('refresh-models') || !openclawInstalled;
  buttonStates['set-default-model'].button.disabled = logicTaskBusy
    || activeCommands.has('set-default-model')
    || !openclawInstalled
    || modelState.models.length === 0;
  telegramPairingCodeInput.disabled = logicTaskBusy || activeCommands.has('connect-telegram') || !telegramPairingMode;
  defaultModelSelect.disabled = logicTaskBusy
    || activeCommands.has('refresh-models')
    || activeCommands.has('set-default-model')
    || !openclawInstalled
    || modelState.models.length === 0;
  telegramConnectPanel.hidden = !openclawInstalled;
  telegramPairingFields.hidden = !telegramPairingMode;
  if (chatRunGatewayButton) {
    chatRunGatewayButton.disabled = logicTaskBusy || activeCommands.has('run-gateway') || !openclawInstalled || gatewayRunning;
  }
  if (reloadChatButton) {
    reloadChatButton.disabled = !openclawInstalled || !gatewayRunning;
  }
  if (openChatExternallyButton) {
    openChatExternallyButton.disabled = !openclawInstalled;
  }
  updateChatVisibility();

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

  if (command === 'run-gateway') {
    updateChatVisibility();
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
  if (!state?.installed) {
    applyModelState({ primaryModel: null, models: [], warning: null });
  }
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
    if (state?.installed) {
      await refreshModelState();
    }
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
      if (openclawInstalled) {
        void refreshModelState();
      }
    }
    if (command === 'install' && result?.status === 'ok') {
      refreshChatFrame();
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
        applyModelState({ primaryModel: null, models: [], warning: null });
      }
      syncButtonAvailability();
      refreshChatFrame(true);
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

chatTabButton.addEventListener('click', () => {
  setActiveTab('chat');
});

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

modelTabButton.addEventListener('click', () => {
  setActiveTab('model');
  if (openclawInstalled && modelState.models.length === 0) {
    void refreshModelState();
  }
});

guideTabButton.addEventListener('click', () => {
  setActiveTab('guide');
});

reloadChatButton.addEventListener('click', () => {
  refreshChatFrame(true);
});

openChatExternallyButton.addEventListener('click', async () => {
  try {
    await window.openclaw.openDashboardExternally();
    appendLog(`[${new Date().toLocaleTimeString()}] chat: Đã mở chat OpenClaw ngoài app.`);
  } catch (error) {
    const errorMessage = error?.message || String(error);
    appendLog(`[${new Date().toLocaleTimeString()}] lỗi chat: ${errorMessage}`);
    statusElement.textContent = 'Không mở được chat ngoài app';
  }
});

chatRunGatewayButton.addEventListener('click', () => {
  setActiveTab('chat');
  sendOpenClawCommand('run-gateway', {});
});

window.addEventListener('resize', () => {
  if (activeTab === 'chat' && openclawInstalled && gatewayRunning) {
    void syncEmbeddedChat(false);
  }
});

buttonStates['refresh-models'].button.addEventListener('click', () => {
  setActiveTab('model');
  void refreshModelState();
});

buttonStates['set-default-model'].button.addEventListener('click', () => {
  setActiveTab('model');
  void saveDefaultModelSelection();
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
      refreshChatFrame(true);
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
