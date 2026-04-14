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
let syncPath = ''
let syncWatcher = null

async function loadSettings() {
  try {
    const data = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    clipperPath = data.clipperPath || path.join(app.getPath('documents'), 'HouseLoan_Clippings')
    syncPath = data.syncPath || ''
  } catch (e) {
    clipperPath = path.join(app.getPath('documents'), 'HouseLoan_Clippings')
  }
}

async function startSyncEngine() {
  if (!syncPath || !storage) return
  if (syncWatcher) syncWatcher.close()

  console.log(`[Sync] Starting Bidirectional Sync at: ${syncPath}`)
  await fs.mkdir(syncPath, { recursive: true })

  const drive = storage.getDrive()
  if (!drive) return

  // 1. Initial Sync: P2P -> Local
  try {
    for await (const entry of drive.list('/')) {
      if (entry.value.type !== 'file') continue
      if (entry.key.startsWith('/.trash')) continue
      
      const localFile = path.join(syncPath, entry.key)
      const localDir = path.dirname(localFile)
      await fs.mkdir(localDir, { recursive: true })
      
      const content = await drive.get(entry.key)
      await fs.writeFile(localFile, content)
    }
  } catch (e) { console.error('[Sync] Initial P2P->Local failed:', e.message) }

  // 2. Local Watcher: Local -> P2P
  syncWatcher = fs.watch(syncPath, { recursive: true }, async (eventType, filename) => {
    if (!filename) return
    const fullPath = path.join(syncPath, filename)
    const p2pKey = '/' + filename.replace(/\\/g, '/')
    
    try {
      const stats = await fs.stat(fullPath)
      if (stats.isFile()) {
        const content = await fs.readFile(fullPath)
        await drive.put(p2pKey, content)
        console.log(`[Sync] Local -> P2P: ${p2pKey}`)
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        // File deleted locally -> Move to P2P Trash
        await storage.moveToTrash(p2pKey)
      }
    }
  })

  // 3. P2P Watcher: P2P -> Local
  const syncP2pToLocal = async () => {
    console.log('[Sync] P2P -> Local Sync Triggered')
    try {
      for await (const entry of drive.list('/')) {
        if (entry.value.type !== 'file') continue
        if (entry.key.startsWith('/.trash')) continue
        
        const localFile = path.join(syncPath, entry.key)
        const localDir = path.dirname(localFile)
        
        // Only download if missing or different mtime/size
        try {
          const localStats = await fs.stat(localFile)
          if (localStats.size === entry.value.size) continue 
        } catch (e) { /* File doesn't exist, proceed to download */ }

        await fs.mkdir(localDir, { recursive: true })
        const content = await drive.get(entry.key)
        await fs.writeFile(localFile, content)
        console.log(`[Sync] P2P -> Local: ${entry.key}`)
      }
    } catch (e) { console.error('[Sync] P2P->Local failed:', e.message) }
  }

  drive.core.on('append', () => {
    // Debounce to avoid constant scanning during batch updates
    clearTimeout(drive._syncTimer)
    drive._syncTimer = setTimeout(syncP2pToLocal, 2000)
  })
}

async function saveSettings() {
  await fs.writeFile(settingsPath, JSON.stringify({ clipperPath, syncPath }), 'utf8')
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 500,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.loadFile('index.html')

  try {
    storage = new P2PStorage(storagePath)
    await loadSettings()
    await storage.ready()
    
    // Start the Dropbox Sync Engine
    await startSyncEngine()

    // --- Web Clipper Receiver (Port 44123) ---
    const clipperServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
      
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

      if (req.method === 'POST' && req.url === '/api/clip') {
        let body = ''
        console.log('[Bridge] Incoming clipping request...')
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
          try {
            const data = JSON.parse(body)
            console.log(`[Bridge] Received: ${data.title} (${body.length} bytes)`)

            // 1. Determine Target Path (Local First)
            const now = new Date()
            const year = now.getFullYear().toString()
            const month = (now.getMonth() + 1).toString().padStart(2, '0')
            const day = now.getDate().toString().padStart(2, '0')
            
            let slug = data.title
              .toLowerCase()
              .replace(/[<>:"/\\|?*]/g, '')
              .trim()
              .replace(/\s+/g, '-')
              .slice(0, 50)
            
            if (!slug) slug = 'untitled-' + now.getTime()

            // If syncPath is set, save directly into the Sync Directory (The Dropbox Way)
            const baseDir = syncPath || clipperPath
            const clipDir = path.join(baseDir, year, month, `${day}-${slug}`)
            
            // 2. Perform Local HDD Save (High Priority)
            try {
              await fs.mkdir(clipDir, { recursive: true })
              await fs.mkdir(path.join(clipDir, 'assets'), { recursive: true })
              await fs.writeFile(path.join(clipDir, 'index.md'), data.markdown, 'utf8')
              for (const asset of data.assets) {
                await fs.writeFile(path.join(clipDir, 'assets', asset.filename), Buffer.from(asset.base64, 'base64'))
              }
              console.log(`[Bridge] Local HDD Save OK: ${clipDir}`)
            } catch (err) {
              console.error('[Bridge] Local backup FAILED:', err.message)
              // We still continue to respond success if P2P might work, or fail if HDD is essential
            }

            // 3. IMMEDIATE RESPONSE to Extension (End the "Syncing..." hang)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
            console.log('[Bridge] Responded SUCCESS to Extension mid-process')

            // 4. Background P2P Sync (Low Priority / Fire-and-Forget)
            if (storage && storage.getDrive()) {
              storage.saveClip(data.title, data.url, data.markdown, data.assets)
                .then(() => {
                  console.log('[Bridge] Background P2P sync complete')
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('state-update', storage.getState())
                  }
                })
                .catch(e => console.error('[Bridge] Background P2P sync failed:', e.message))
            }
          } catch (err) {
            console.error('[Bridge] Fatal request error:', err.message)
            if (!res.writableEnded) {
              res.writeHead(500); res.end(err.message)
            }
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

// P2P Sync Folder (Dropbox style)
ipcMain.handle('get-sync-path', () => syncPath)
ipcMain.handle('select-sync-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    syncPath = result.filePaths[0]
    await saveSettings()
    await startSyncEngine() // Restart engine with new path
    return syncPath
  }
  return null
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
