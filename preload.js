const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveFile: (notebookId, fileObj) => ipcRenderer.invoke('save-file', notebookId, fileObj),
  readFile: (filePath, remoteKey) => ipcRenderer.invoke('read-file', filePath, remoteKey),
  connectRemote: (hexKey) => ipcRenderer.invoke('connect-remote', hexKey),
  deleteFile: (notebookId, docId) => ipcRenderer.invoke('delete-file', notebookId, docId),
  windowControl: (action) => ipcRenderer.send('window-control', action),
  onStateUpdate: (callback) => ipcRenderer.on('state-update', (_event, state) => callback(state))
})
