const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openclaw', {
  sendCommand: (command, params) => ipcRenderer.invoke('openclaw:command', command, params),
  getAppState: () => ipcRenderer.invoke('openclaw:get-app-state'),
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
