import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { P2PStorage } from './p2p-storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const storagePath = path.join(app.getPath('userData'), 'p2p-storage')

let storage = null
let mainWindow = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 500,
    frame: false, // We have a custom title bar
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // Load UI immediately so the user doesn't see a blank screen
  mainWindow.loadFile('index.html')

  try {
    // Initialize P2P Storage (Main Process / Node Environment)
    console.log('[Main] Initializing P2P Storage...')
    storage = new P2PStorage(storagePath)
    await storage.ready()
    console.log('[Main] P2P Storage Ready.')
    
    // Set up periodic sync of peer status to frontend
    setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed() && storage) {
        mainWindow.webContents.send('state-update', storage.getState())
      }
    }, 2000)

    // Periodic stats saving to disk (every 10 minutes)
    setInterval(() => {
      if (storage) storage._saveStats()
    }, 600000)
  } catch (err) {
    console.error('[Main] P2P Initialization failed:', err)
    // Send error to UI if possible
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('state-update', { error: err.message })
      }
    }, 1000)
  }
}

// IPC Handlers mapped to frontend api requests
ipcMain.handle('get-state', () => storage.getState())
ipcMain.handle('save-file', async (e, notebookId, fileObj) => await storage.saveFile(notebookId, fileObj))
ipcMain.handle('read-file', async (e, filePath, remoteKey) => await storage.readFile(filePath, remoteKey))
ipcMain.handle('connect-remote', async (e, hexKey) => await storage.connectRemote(hexKey))
ipcMain.handle('delete-file', async (e, notebookId, docId) => await storage.deleteFile(notebookId, docId))

ipcMain.on('window-control', (e, action) => {
  if (!mainWindow) return
  if (action === 'minimize') mainWindow.minimize()
  if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize()
  if (action === 'close') app.quit()
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', async () => {
  if (storage) {
    await storage._saveStats()
    if (storage.swarm) storage.swarm.destroy()
  }
})
