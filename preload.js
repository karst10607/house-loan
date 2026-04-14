const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveFile: (notebookId, fileObj) => ipcRenderer.invoke('save-file', notebookId, fileObj),
  readFile: (filePath, remoteKey) => ipcRenderer.invoke('read-file', filePath, remoteKey),
  connectRemote: async (hexKey) => await ipcRenderer.invoke('connect-remote', hexKey),
  deleteFile: async (notebookId, docId) => await ipcRenderer.invoke('delete-file', notebookId, docId),
  windowControl: (action) => ipcRenderer.send('window-control', action),
  
  // Clipper Settings
  getClipperPath: async () => await ipcRenderer.invoke('get-clipper-path'),
  selectClipperFolder: async () => await ipcRenderer.invoke('select-clipper-folder'),
  openClippingsFolder: async () => await ipcRenderer.invoke('open-clippings-folder'),
  
  onStateUpdate: (callback) => ipcRenderer.on('state-update', (_event, state) => callback(state))
})
