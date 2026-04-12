import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'

export class P2PStorage {
  constructor(storagePath) {
    this.store = new Corestore(storagePath)
    this.drive = null
    this.swarm = null
    this.remoteDrives = new Map()
    this.peerCount = 0

    this.notebooks = [
      { id: 'nb-1', title: '預設資料夾', count: 0 }
    ]
    this.documents = { 'nb-1': [] }

    this.onPeerChange = null
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

    this.swarm.join(this.drive.discoveryKey)
    await this.swarm.flush()

    console.log('[P2P] Local drive key:', b4a.toString(this.drive.key, 'hex'))
    return b4a.toString(this.drive.key, 'hex')
  }

  get key() {
    return this.drive && this.drive.key ? b4a.toString(this.drive.key, 'hex') : null
  }

  async connectRemote(hexKey) {
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

  getState() {
    return {
      notebooks: this.notebooks,
      documents: this.documents,
      key: this.key,
      peerCount: this.peerCount
    }
  }
}
