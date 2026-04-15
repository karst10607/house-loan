import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import path from 'path'
import http from 'http'
import https from 'https'
import httpMod from 'http'
import fs from 'fs/promises'
import fsSync from 'fs'
import { fileURLToPath } from 'url'
import { P2PStorage } from './p2p-storage.js'
import { Defuddle } from 'defuddle'

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

// ─── Image Downloader (stream-based, no base64) ──────────────
function downloadImage(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects === 0) return reject(new Error('Too many redirects'))
    const protocol = url.startsWith('https') ? https : httpMod
    protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location, dest, redirects - 1).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      const file = fsSync.createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
      file.on('error', reject)
    }).on('error', reject)
  })
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
            console.log(`[Bridge] Received: "${data.title}" html=${(body.length/1024).toFixed(1)}KB imgs=${(data.imageUrls||[]).length}`)

            // 1. Convert HTML -> Markdown with defuddle (server-side, high quality)
            let markdown = ''
            try {
              const parsed = Defuddle.parse(data.html, { url: data.url })
              const frontmatter = [
                '---',
                `title: "${(parsed.title || data.title).replace(/"/g, '\\"')}"`,
                `url: "${data.url}"`,
                `date: "${new Date().toISOString()}"`,
                `author: "${parsed.author || ''}"`,
                `description: "${(parsed.description || '').replace(/"/g, '\\"')}"`,
                `published: "${parsed.published || ''}"`,
                `type: clipping`,
                '---',
                ''
              ].join('\n')
              markdown = frontmatter + (parsed.content || '')
              console.log(`[Bridge] defuddle OK: ${parsed.wordCount || 0} words`)
            } catch (defuddleErr) {
              console.warn('[Bridge] defuddle failed, using raw fallback:', defuddleErr.message)
              markdown = `---\ntitle: "${data.title}"\nurl: "${data.url}"\ndate: "${new Date().toISOString()}"\ntype: clipping\n---\n\n${data.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}`
            }

            // 2. Determine path & write Markdown to local disk immediately
            const now = new Date()
            const year = now.getFullYear().toString()
            const month = (now.getMonth() + 1).toString().padStart(2, '0')
            const day = now.getDate().toString().padStart(2, '0')
            let slug = data.title.toLowerCase().replace(/[<>:"/\\|?*]/g, '').trim().replace(/\s+/g, '-').slice(0, 50)
            if (!slug) slug = 'untitled-' + now.getTime()

            const baseDir = syncPath || clipperPath
            const clipDir = path.join(baseDir, year, month, `${day}-${slug}`)
            const assetsDir = path.join(clipDir, 'assets')

            await fs.mkdir(clipDir, { recursive: true })
            await fs.mkdir(assetsDir, { recursive: true })
            await fs.writeFile(path.join(clipDir, 'index.md'), markdown, 'utf8')
            console.log(`[Bridge] Local MD saved: ${clipDir}`)

            // 3. RESPOND IMMEDIATELY to Extension — job done from user's perspective
            const imageUrls = data.imageUrls || []
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, imageCount: imageUrls.length }))
            console.log('[Bridge] SUCCESS sent to Extension')

            // 4. Background: Download images with Node.js streams (no base64!)
            ;(async () => {
              let downloaded = 0
              for (const imgUrl of imageUrls) {
                try {
                  const rawFilename = imgUrl.split('/').pop().split('?')[0] || `img-${downloaded}.jpg`
                  const filename = rawFilename.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? rawFilename : rawFilename + '.jpg'
                  const dest = path.join(assetsDir, filename)
                  await downloadImage(imgUrl, dest)
                  downloaded++
                } catch (e) {
                  console.warn(`[Bridge] Image skip: ${imgUrl} — ${e.message}`)
                }
              }
              console.log(`[Bridge] Images done: ${downloaded}/${imageUrls.length}`)

              // 5. Background P2P sync after images are ready
              if (storage && storage.getDrive()) {
                storage.saveClip(data.title, data.url, markdown, [])
                  .then(() => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                      mainWindow.webContents.send('state-update', storage.getState())
                    }
                  })
                  .catch(e => console.error('[Bridge] P2P sync failed:', e.message))
              }
            })()

          } catch (err) {
            console.error('[Bridge] Fatal error:', err.message)
            if (!res.writableEnded) { res.writeHead(500); res.end(err.message) }
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
