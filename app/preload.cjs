// The canvas page's only door into the app: send it messages and ask for a screenshot.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('doodleNative', {
  post: (msg) => ipcRenderer.send('doodle', msg),
  capture: (opts) => ipcRenderer.invoke('doodle-capture', opts),
});
