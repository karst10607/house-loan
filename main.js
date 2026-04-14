import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import path from 'path'
import http from 'http'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { P2PStorage } from './p2p-storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const storagePath = path.join(app.getPath('userData'), 'p2p-storage')
const settingsPath = path.join(app.getPath('userData'), 'settings.json')

let storage = null
let mainWindow = null
let clipperPath = ''

async function loadSettings() {
  try {
    const data = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    clipperPath = data.clipperPath
  } catch (e) {
    // Default to Documents/HouseLoan_Clippings
    clipperPath = path.join(app.getPath('documents'), 'HouseLoan_Clippings')
  }
}

async function saveSettings() {
  await fs.writeFile(settingsPath, JSON.stringify({ clipperPath }), 'utf8')
}

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
    // Initialize P2P Storage
    console.log('[Main] Initializing P2P Storage...')
    storage = new P2PStorage(storagePath)

    // Init Settings
    await loadSettings()

    // --- Web Clipper Receiver (Port 44123) ---
    const clipperServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
      
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

      if (req.method === 'POST' && req.url === '/api/clip') {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
          try {
            const data = JSON.parse(body)
            
            // 1. P2P Storage
            await storage.saveClip(data.title, data.url, data.markdown, data.assets)

            // 2. Custom Local Hard Drive Backup
            try {
              const clipDir = path.join(clipperPath, `${Date.now()}-${data.title.replace(/[^\w\s-]/g, '').slice(0, 30).trim().replace(/\s+/g, '-')}`)
              await fs.mkdir(clipDir, { recursive: true })
              await fs.mkdir(path.join(clipDir, 'assets'), { recursive: true })

              await fs.writeFile(path.join(clipDir, 'index.md'), data.markdown, 'utf8')
              for (const asset of data.assets) {
                await fs.writeFile(path.join(clipDir, 'assets', asset.filename), Buffer.from(asset.base64, 'base64'))
              }
              console.log(`[Main] Local backup saved to: ${clipDir}`)
            } catch (err) {
              console.warn('[Main] Local backup failed:', err.message)
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('state-update', storage.getState())
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err) {
            res.writeHead(500); res.end(err.message)
          }
        })
      } else {
        res.writeHead(404); res.end()
      }
    })

    clipperServer.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.warn('[Main] Clipper Bridge port (44123) already in use. Skipping server start.')
      } else {
        console.error('[Main] Clipper Bridge Server error:', e.message)
      }
    })

    clipperServer.listen(44123, '127.0.0.1', () => {
      console.log('[Main] Clipper Bridge listening on http://127.0.0.1:44123')
    })

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

// Clipper Settings & Folder Ops
ipcMain.handle('get-clipper-path', () => clipperPath)
ipcMain.handle('select-clipper-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    clipperPath = result.filePaths[0]
    await saveSettings()
    return clipperPath
  }
  return null
})
ipcMain.handle('open-clippings-folder', async () => {
  await shell.openPath(clipperPath)
})

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
    await storage._savePeers()
    await storage._saveStats()
    if (storage.swarm) storage.swarm.destroy()
  }
})
