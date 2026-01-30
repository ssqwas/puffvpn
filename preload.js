const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (vlessKey, mode) => ipcRenderer.invoke('connect', { vlessKey, mode }),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  minimize: () => ipcRenderer.send('minimize'),
  close: () => ipcRenderer.send('close'),
  onTrayConnect: (callback) => ipcRenderer.on('tray-connect', callback),
  onTrayDisconnect: (callback) => ipcRenderer.on('tray-disconnect', callback),
  onVpnLog: (callback) => ipcRenderer.on('vpn-log', (event, data) => callback(data)),
  removeVpnLogListener: () => ipcRenderer.removeAllListeners('vpn-log')
});
