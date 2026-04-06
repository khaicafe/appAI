const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openclaw', {
  sendCommand: (command, params) => ipcRenderer.invoke('openclaw:command', command, params),
  getAppState: () => ipcRenderer.invoke('openclaw:get-app-state'),
  getModelState: () => ipcRenderer.invoke('openclaw:get-model-state'),
  setDefaultModel: (modelName) => ipcRenderer.invoke('openclaw:set-default-model', modelName),
  openDashboardExternally: () => ipcRenderer.invoke('openclaw:open-dashboard'),
  showEmbeddedChat: (bounds, options) => ipcRenderer.invoke('openclaw:show-embedded-chat', bounds, options),
  hideEmbeddedChat: () => ipcRenderer.invoke('openclaw:hide-embedded-chat'),
  onGatewayLog: (callback) => {
    ipcRenderer.on('gateway-log', (_event, message) => callback(message));
  },
  onGatewayReady: (callback) => {
    ipcRenderer.on('gateway-ready', (_event, info) => callback(info));
  },
  onLogicTaskState: (callback) => {
    ipcRenderer.on('logic-task-state', (_event, state) => callback(state));
  },
});
