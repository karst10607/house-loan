import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import fs from 'node:fs/promises'
import path from 'node:path'

export class P2PStorage {
  constructor(storagePath) {
    this.storagePath = storagePath
    this.peersPath = path.join(storagePath, 'peers.json')
    this.statsPath = path.join(storagePath, 'stats.json')
    this.store = new Corestore(storagePath)
    this.drive = null
    this.swarm = null
    this.remoteDrives = new Map()
    this.peerCount = 0
    this._driveKey = null

    // Stats
    this.sessionStartTime = Date.now()
    this.persistedSeedTime = 0 // ms
    this.totalUploadedBytes = 0
    this.totalUploadedBlocks = 0
    this.uploadSpeed = 0
    this._uploadSamples = []  // rolling window for speed calc

    this.notebooks = [
      { id: 'nb-1', title: '預設資料夾', count: 0 },
      { id: 'nb-clippings', title: '📦 網頁快照', count: 0 }
    ]
    this.documents = { 'nb-1': [], 'nb-clippings': [] }

    this.onPeerChange = null
  }

  getDrive() { return this.drive }

  async moveToTrash(path) {
    if (!this.drive) return
    const trashPath = `/.trash/${Date.now()}-${path.split('/').pop()}`
    try {
      const u8 = await this.drive.get(path)
      if (u8) {
        await this.drive.put(trashPath, u8)
        await this.drive.del(path)
        console.log(`[P2P] Soft-deleted: ${path} -> ${trashPath}`)
      }
    } catch (e) {
      console.warn(`[P2P] Soft-delete failed for ${path}:`, e.message)
    }
  }

  async saveClip(title, url, markdown, assets = []) {
    if (!this.drive) throw new Error('Drive not ready')
    
    // 1. Generate Hierarchical Path: YYYY/MM/DD-slug
    const now = new Date()
    const year = now.getFullYear().toString()
    const month = (now.getMonth() + 1).toString().padStart(2, '0')
    const day = now.getDate().toString().padStart(2, '0')
    
    // Better Slugify: Support Chinese characters, but keep it filesystem safe
    let slug = title
      .toLowerCase()
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid Windows filename characters
      .trim()
      .replace(/\s+/g, '-')         // Space to hyphen
      .slice(0, 50)                 // Limit length
    
    if (!slug) slug = 'untitled-' + Date.now()
    
    const folderPath = `/clippings/${year}/${month}/${day}-${slug}`

    // 2. Save assets (individual files in Hyperdrive)
    if (assets.length > 0) {
      console.log(`[P2P] Saving ${assets.length} assets in hierachy: ${folderPath}`)
      for (const asset of assets) {
        const assetPath = `${folderPath}/assets/${asset.filename}`
        const buffer = b4a.from(asset.base64, 'base64')
        await this.drive.put(assetPath, buffer)
      }
    }

    // 3. Save index.md
    await this.drive.put(`${folderPath}/index.md`, b4a.from(markdown, 'utf8'))

    const doc = {
      id: 'clip-' + Date.now(),
      title: '🌐 ' + title, // This will be the human name
      path: `${folderPath}/index.md`,
      type: 'text',
      mime: 'text/markdown',
      date: now.toLocaleDateString(),
      url: url
    }

    if (!this.documents['nb-clippings']) this.documents['nb-clippings'] = []
    this.documents['nb-clippings'].push(doc)

    const nb = this.notebooks.find(n => n.id === 'nb-clippings')
    if (nb) nb.count = this.documents['nb-clippings'].length

    console.log(`[P2P] Web clip (MD) saved successfully: ${title}`)
    return doc
  }

  async ready() {
    this.drive = new Hyperdrive(this.store)
    await this.drive.ready()

    this.swarm = new Hyperswarm()

    this.swarm.on('connection', (conn, info) => {
      this.peerCount++
      console.log(`[Swarm] Peer connected (total: ${this.peerCount})`)
      this.store.replicate(conn)

      conn.on('close', () => {
        this.peerCount--
        console.log(`[Swarm] Peer disconnected (total: ${this.peerCount})`)
        if (this.onPeerChange) this.onPeerChange(this.peerCount)
      })

      conn.on('error', (err) => {
        console.error('[Swarm] Connection error:', err.message)
      })

      if (this.onPeerChange) this.onPeerChange(this.peerCount)
    })

    // Monitor upload traffic across all cores in the store
    this.store.on('core', (core) => {
      core.on('upload', (index, byteLength) => {
        this.totalUploadedBytes += byteLength
        this.totalUploadedBlocks++
        this._uploadSamples.push({ ts: Date.now(), bytes: byteLength })
        // Keep only last 30 seconds for speed calculation
        const cutoff = Date.now() - 30000
        this._uploadSamples = this._uploadSamples.filter(s => s.ts > cutoff)
      })
    })

    this.swarm.join(this.drive.discoveryKey)
    await this.swarm.flush()

    this._driveKey = b4a.toString(this.drive.key, 'hex')
    console.log('[P2P] Local drive key:', this._driveKey)
    console.log('[P2P] Path Debug:', { storage: this.storagePath, peers: this.peersPath })

    // Load persisted data
    await this._loadPeers()
    await this._loadStats()
    
    // Rebuild document index from Hyperdrive
    await this.rebuildIndex()

    return this._driveKey
  }

  async rebuildIndex() {
    if (!this.drive) return
    console.log('[P2P] Rebuilding Index...')
    const clippings = []
    const defaults = []

    try {
      for await (const entry of this.drive.list('/', { recursive: true })) {
        if (entry.value.type !== 'file') continue
        
        const path = entry.key
        const filename = path.split('/').pop()
        
        // 1. Identify Clippings (index.md in hierarchy)
        if (path.startsWith('/clippings/') && filename === 'index.md') {
          // Extract a human title from the path slug if needed, but App will parse Frontmatter later
          // For now, we'll use a placeholder or the last segment of the path
          const segments = path.split('/')
          const slug = segments[segments.length - 2] || 'Untitled'
          
          clippings.push({
            id: 'clip-' + Date.now() + Math.random(),
            title: '🌐 ' + slug,
            path: path,
            type: 'text',
            mime: 'text/markdown',
            date: new Date(entry.value.mtime).toLocaleDateString(),
            url: '' // Will be populated by Frontmatter on preview
          })
        } 
        // 2. Identify Normal Uploads
        else if (path.startsWith('/uploads/')) {
          defaults.push({
            id: 'doc-' + Date.now() + Math.random(),
            title: filename,
            path: path,
            type: filename.match(/\.(jpg|jpeg|png|gif)$/i) ? 'image' : 'text',
            mime: filename.endsWith('.pdf') ? 'application/pdf' : 'text/plain',
            date: new Date(entry.value.mtime).toLocaleDateString()
          })
        }
      }

      this.documents['nb-clippings'] = clippings
      this.documents['nb-1'] = defaults
      
      const nbClippings = this.notebooks.find(n => n.id === 'nb-clippings')
      if (nbClippings) nbClippings.count = clippings.length
      
      const nbDefault = this.notebooks.find(n => n.id === 'nb-1')
      if (nbDefault) nbDefault.count = defaults.length

      console.log(`[P2P] Index rebuilt: ${clippings.length} clippings, ${defaults.length} uploads.`)
    } catch (e) {
      console.error('[P2P] Index rebuild failed:', e.message)
    }
  }

  async _saveStats() {
    try {
      const currentSessionTime = Date.now() - this.sessionStartTime
      const data = {
        totalSeedTime: this.persistedSeedTime + currentSessionTime,
        totalUploadedBytes: this.totalUploadedBytes
      }
      await fs.writeFile(this.statsPath, JSON.stringify(data))
    } catch (e) {
      console.error('[P2P] Failed to save stats:', e.message)
    }
  }

  async _loadStats() {
    try {
      const data = JSON.parse(await fs.readFile(this.statsPath, 'utf8'))
      this.persistedSeedTime = data.totalSeedTime || 0
      this.totalUploadedBytes = data.totalUploadedBytes || 0
    } catch (e) {
      // First run
    }
  }

  async _savePeers() {
    try {
      // Save as rich friend objects with metadata (never lose a friend on crash)
      const friends = Array.from(this.remoteDrives.keys()).map(key => ({
        key,
        alias: key.slice(0, 12),
        addedAt: Date.now()
      }))
      // Merge with existing friends file to preserve old entries
      let existing = []
      try {
        existing = JSON.parse(await fs.readFile(this.peersPath, 'utf8'))
        if (!Array.isArray(existing)) existing = existing.map ? existing : []
        // Migrate from old string[] format
        existing = existing.map(e => typeof e === 'string' ? { key: e, alias: e.slice(0,12), addedAt: Date.now() } : e)
      } catch (_) {}
      // Merge: keep all unique keys
      const merged = new Map()
      for (const f of [...existing, ...friends]) merged.set(f.key, f)
      await fs.writeFile(this.peersPath, JSON.stringify([...merged.values()], null, 2), 'utf8')
      console.log(`[P2P] Saved ${merged.size} friends to disk`)
    } catch (e) {
      console.error('[P2P] Failed to save peers:', e.message)
    }
  }

  async _loadPeers() {
    try {
      const raw = await fs.readFile(this.peersPath, 'utf8')
      let entries = JSON.parse(raw)
      // Handle old string[] format gracefully
      if (Array.isArray(entries) && entries.length > 0) {
        const friends = entries.map(e => typeof e === 'string' ? { key: e, alias: e.slice(0,12), addedAt: 0 } : e)
        this._persistedFriends = friends  // Cache for offline display
        console.log(`[P2P] Found ${friends.length} friends. Reconnecting in background...`)
        
        // Reconnect in parallel, but NEVER remove a friend on failure
        const results = await Promise.allSettled(friends.map(f => this.connectRemote(f.key, true)))
        const ok = results.filter(r => r.status === 'fulfilled').length
        const fail = results.filter(r => r.status === 'rejected').length
        console.log(`[P2P] Reconnection: ${ok} ok, ${fail} offline (kept in friends list)`)
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.log('[P2P] No friends file found (first run)')
      } else {
        console.error('[P2P] Failed to load peers:', e.message)
      }
    }
  }

  getFriendsList() {
    // Return all persisted friends with online/offline status
    const onlineKeys = new Set(this.remoteDrives.keys())
    // Include online ones
    const friends = Array.from(this.remoteDrives.keys()).map(key => ({
      key,
      alias: key.slice(0, 12),
      online: true
    }))
    // Also include any from the _persistedFriends cache that aren't online
    if (this._persistedFriends) {
      for (const f of this._persistedFriends) {
        if (!onlineKeys.has(f.key)) {
          friends.push({ key: f.key, alias: f.alias || f.key.slice(0, 12), online: false })
        }
      }
    }
    return friends
  }

  get key() {
    return this._driveKey || (this.drive && this.drive.key ? b4a.toString(this.drive.key, 'hex') : null)
  }

  async connectRemote(hexKey, isLoading = false) {
    if (this.remoteDrives.has(hexKey)) {
      return { already: true, key: hexKey }
    }

    const remoteKey = b4a.from(hexKey, 'hex')
    const remoteDrive = new Hyperdrive(this.store, remoteKey)
    await remoteDrive.ready()

    this.swarm.join(remoteDrive.discoveryKey)
    await this.swarm.flush()

    this.remoteDrives.set(hexKey, remoteDrive)

    const nbId = 'remote-' + hexKey.slice(0, 8)
    this.notebooks.push({
      id: nbId,
      title: '🔗 ' + hexKey.slice(0, 12) + '...',
      count: 0,
      syncing: true, // Mark as syncing
      remote: true,
      driveKey: hexKey
    })
    this.documents[nbId] = []

    this._scanRemoteDrive(remoteDrive, nbId, hexKey)

    console.log('[P2P] Connected to remote:', hexKey)

    // Persist to disk unless we are currently loading
    if (!isLoading) {
      await this._savePeers()
    }

    return { already: false, key: hexKey, notebookId: nbId }
  }

  async _scanRemoteDrive(remoteDrive, notebookId, hexKey) {
    try {
      console.log(`[P2P] Starting sync for ${notebookId}...`)
      
      // Wait for the drive to find peers and update its metadata
      // This is much more reliable than a fixed timeout
      await remoteDrive.update()
      
      const doScan = async () => {
        const docs = []
        try {
          // Hyperdrive v13 list() works great once metadata is updated
          for await (const entry of remoteDrive.list('/files/')) {
            const name = entry.key.split('/').pop().replace(/^doc-\d+-/, '')
            docs.push({
              id: 'rdoc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              title: name,
              path: entry.key,
              type: this._guessType(name),
              mime: this._guessMime(name),
              date: new Date().toLocaleDateString(),
              remote: true,
              driveKey: hexKey
            })
          }
          
          this.documents[notebookId] = docs
          const nb = this.notebooks.find(n => n.id === notebookId)
          if (nb) {
            nb.count = docs.length
            nb.syncing = false // Finished initial sync
          }
          
          console.log(`[P2P] Scanned remote ${notebookId}: found ${docs.length} files`)
          if (this.onPeerChange) this.onPeerChange(this.peerCount)
        } catch (e) {
          console.error('[P2P] Scan error loop:', e.message)
        }
      }

      // Initial scan
      await doScan()

      // Set up a "watch" or periodic refresh for remote drives
      // In a real production app, we would use drive.core.on('append')
      // but simple polling every 10s for remote drives is very sturdy for now.
      const interval = setInterval(async () => {
        if (!this.remoteDrives.has(hexKey)) return clearInterval(interval)
        await remoteDrive.update()
        await doScan()
      }, 10000)

    } catch (err) {
      console.error('[P2P] Remote init error:', err.message)
      const nb = this.notebooks.find(n => n.id === notebookId)
      if (nb) nb.syncing = false
    }
  }

  _guessType(filename) {
    const ext = filename.split('.').pop().toLowerCase()
    if (ext === 'pdf') return 'pdf'
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
    return 'text'
  }

  _guessMime(filename) {
    const ext = filename.split('.').pop().toLowerCase()
    const map = {
      pdf: 'application/pdf',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      md: 'text/markdown', txt: 'text/plain'
    }
    return map[ext] || 'application/octet-stream'
  }

  async saveFile(notebookId, fileObj) {
    if (!this.drive) throw new Error('Drive not ready')
    const { name, type, base64 } = fileObj
    const docId = 'doc-' + Date.now()
    const filePath = `/files/${docId}-${name}`

    const buffer = b4a.from(base64, 'base64')
    await this.drive.put(filePath, buffer)

    const doc = {
      id: docId,
      title: name,
      path: filePath,
      type: type.includes('pdf') ? 'pdf' : (type.includes('image') ? 'image' : 'text'),
      mime: type,
      date: new Date().toLocaleDateString()
    }

    if (!this.documents[notebookId]) this.documents[notebookId] = []
    this.documents[notebookId].push(doc)

    const nb = this.notebooks.find(n => n.id === notebookId)
    if (nb) nb.count = this.documents[notebookId].length

    return doc
  }

  async deleteFile(notebookId, docId) {
    if (!this.drive) throw new Error('Drive not ready')
    
    const docs = this.documents[notebookId] || []
    const index = docs.findIndex(d => d.id === docId)
    if (index === -1) throw new Error('Document not found')

    const doc = docs[index]
    if (doc.remote) throw new Error('Cannot delete remote files')

    // Delete from Hyperdrive
    await this.drive.del(doc.path)

    // Update local state
    docs.splice(index, 1)
    
    const nb = this.notebooks.find(n => n.id === notebookId)
    if (nb) nb.count = docs.length

    console.log(`[P2P] Deleted file: ${doc.path}`)
    return { success: true }
  }

  async readFile(filePath, remoteKey) {
    let drive = this.drive
    if (remoteKey && this.remoteDrives.has(remoteKey)) {
      drive = this.remoteDrives.get(remoteKey)
    }
    if (!drive) throw new Error('Drive not ready')
    const buffer = await drive.get(filePath)
    if (!buffer) throw new Error('File not found: ' + filePath)
    return b4a.toString(buffer, 'base64')
  }

  getSeedingStats() {
    // Calculate upload speed from rolling 30s window
    const cutoff = Date.now() - 30000
    const recent = this._uploadSamples.filter(s => s.ts > cutoff)
    const totalRecent = recent.reduce((sum, s) => sum + s.bytes, 0)
    const windowSec = recent.length > 0 ? (Date.now() - recent[0].ts) / 1000 : 1
    this.uploadSpeed = windowSec > 0 ? Math.round(totalRecent / windowSec) : 0

    // Drive block stats (how much of our data is available)
    let totalBlocks = 0
    let downloadedBlocks = 0
    try {
      if (this.drive && this.drive.core) {
        totalBlocks = this.drive.core.length || 0
        downloadedBlocks = this.drive.core.contiguousLength || 0
      }
    } catch (_) {}

    return {
      totalUploadedBytes: this.totalUploadedBytes,
      totalUploadedBlocks: this.totalUploadedBlocks,
      uploadSpeedBps: this.uploadSpeed,
      driveBlocks: totalBlocks,
      driveContiguous: downloadedBlocks,
      seedingRatio: totalBlocks > 0 ? (this.totalUploadedBlocks / totalBlocks).toFixed(2) : '0.00'
    }
  }

  getState() {
    const currentSessionTime = Date.now() - this.sessionStartTime
    return {
      notebooks: this.notebooks,
      documents: this.documents,
      key: this.key,
      peerCount: this.peerCount,
      friends: this.getFriendsList(),
      seeding: this.getSeedingStats(),
      stats: {
        totalSeedTime: this.persistedSeedTime + currentSessionTime,
        totalUploadedBytes: this.totalUploadedBytes
      }
    }
  }
}
