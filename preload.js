const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cloudmeNative', {
  notify: (title, body) => ipcRenderer.send('show-notification', { title, body })
});
