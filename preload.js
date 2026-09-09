const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aquaMaker', {
  isDesktopApp: true,
  siteUrl: 'botmakeraqua.aquastudios.pl',
  runBotLocally: (payload) => ipcRenderer.send('run-bot-locally', payload),
  stopBotLocally: () => ipcRenderer.send('stop-bot-locally'),
  onRunStatus: (callback) => ipcRenderer.on('run-status', (_event, message) => callback(message)),
  onBotState: (callback) => ipcRenderer.on('bot-state', (_event, state) => callback(state)),
  retryLoad: () => ipcRenderer.send('retry-load'),

  // sterowanie własnym paskiem okna (patrz assets/js/titlebar.js oraz error.html)
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  onWindowState: (callback) => ipcRenderer.on('window-state', (_event, state) => callback(state)),
});
