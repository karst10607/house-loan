/* Electron Renderer Process */

// ─── App version ─────────────────────────────────────────────
const APP_VERSION = '1.16.0'

// ─── Base64 helpers ──────────────────────────────────────────
function bufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
function base64ToUint8(base64) {
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

// ─── App State ───────────────────────────────────────────────
let activeFolderId = null
let currentPdfUrl = null

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupWindowControls()
  setupUploadButton()
  setupConnectButton()
  buildStatusBadge()

  await loadState()
  setupClipperSettingsHandlers()

  // Listen to accurate state updates from Main Process instead of polling
  window.api.onStateUpdate((state) => {
    updatePeerBadge(state.peerCount || 0, state.stats)
    
    // Auto-refresh folders and current document list when state changes
    renderFolders(state.notebooks)
    if (activeFolderId) {
      const docs = state.documents[activeFolderId] || []
      renderDocs(docs)
    }

    // Only update key if it wasn't there
    const keyInput = document.getElementById('my-key-input')
    if (keyInput && (!keyInput.value || keyInput.value === 'Not Ready' || keyInput.value === 'Loading...')) {
      keyInput.value = state.key || 'Not Ready'
    }
  })
})

// ─── Window controls ─────────────────────────────────────────
function setupWindowControls() {
  const btnMin   = document.getElementById('win-min')
  const btnMax   = document.getElementById('win-max')
  const btnClose = document.getElementById('win-close')

  btnMin?.addEventListener('click', () => window.api.windowControl('minimize'))
  btnMax?.addEventListener('click', () => window.api.windowControl('maximize'))
  btnClose?.addEventListener('click', () => window.api.windowControl('close'))
}

// ─── Upload ───────────────────────────────────────────────────
function setupUploadButton() {
  const uploadBtn = document.getElementById('upload-btn')
  const fileInput = document.getElementById('file-upload-input')
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', handleFileUpload)
  }
}

// ─── Connect button ───────────────────────────────────────────
function setupConnectButton() {
  const connectBtn     = document.getElementById('connect-btn')
  const remoteKeyInput = document.getElementById('remote-key-input')
  if (!connectBtn || !remoteKeyInput) return

  connectBtn.addEventListener('click', async () => {
    const hexKey = remoteKeyInput.value.trim()
    if (!hexKey || hexKey.length < 32) return alert('請輸入有效的 Hyperdrive Key')
    connectBtn.textContent = '連線中...'
    connectBtn.disabled = true
    try {
      const result = await window.api.connectRemote(hexKey)
      if (result.already) {
        alert('已經連線到這個 Key 了')
      } else {
        remoteKeyInput.value = ''
        await loadState()
      }
    } catch (err) {
      alert('連線失敗: ' + err.message)
    } finally {
      connectBtn.textContent = '連線'
      connectBtn.disabled = false
    }
  })
}

// ─── Format helpers ───────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ─── Status badge ─────────────────────────────────────────────
function buildStatusBadge() {
  const el = document.createElement('div')
  el.id = 'pear-sync-status'
  el.style.cssText = `
    position:fixed; bottom:8px; right:8px; background:rgba(0,0,0,.7);
    color:#2dd4bf; padding:6px 12px; border-radius:12px; font-size:11px;
    z-index:9999; pointer-events:none; backdrop-filter:blur(12px);
    border:1px solid rgba(45,212,191,.2); display:flex; flex-direction:column; gap:4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `
  el.innerHTML = `
    <div style="display:flex; align-items:center; gap:6px;">
      <span class="status-dot"></span>
      <span class="status-text">v${APP_VERSION} · 0 peers</span>
    </div>
    <div id="status-stats" style="display:none; border-top:1px solid rgba(45,212,191,0.1); padding-top:4px; font-size:10px; opacity:0.8;">
      ⌛ 0m · 📤 0 B
    </div>
  `
  document.body.appendChild(el)
}

function updatePeerBadge(count, stats) {
  const textEl = document.querySelector('#pear-sync-status .status-text')
  const dotEl  = document.querySelector('#pear-sync-status .status-dot')
  const statsEl = document.getElementById('status-stats')

  if (textEl) textEl.textContent = `v${APP_VERSION} · ${count} peer${count !== 1 ? 's' : ''}`
  if (dotEl)  dotEl.style.background = count > 0 ? '#2dd4bf' : '#f87171'

  if (stats && statsEl) {
    statsEl.style.display = 'block'
    statsEl.textContent = `⌛ ${formatTime(stats.totalSeedTime)} · 📤 ${formatBytes(stats.totalUploadedBytes)}`
  }
}

// ─── State loading ────────────────────────────────────────────
async function loadState() {
  try {
    const state = await window.api.getState()
    const keyInput = document.getElementById('my-key-input')
    if (keyInput) {
      keyInput.value = state.key || 'Not Ready'
    }
    updatePeerBadge(state.peerCount || 0, state.stats)

    renderFolders(state.notebooks)
    if (state.notebooks.length > 0) {
      const tgtId = activeFolderId || state.notebooks[0].id
      selectFolder(tgtId, state.documents[tgtId] || [])
    }
  } catch(err) {
    console.error('loadState failed:', err)
    renderFolders([{ id: 'default', title: '預設資料夾 (錯誤)', count: 0 }])
    selectFolder('default', [])
    const keyInput = document.getElementById('my-key-input')
    if (keyInput) keyInput.value = 'Failed to load: ' + err.message
  }
}

// ... updating onStateUpdate as well ...
// ─── Folder Render ────────────────────────────────────────────
function renderFolders(folders) {
  const ul = document.getElementById('folders-list')
  if (!ul) return
  
  ul.innerHTML = ''
  folders.forEach(f => {
    const li = document.createElement('li')
    li.dataset.id = f.id
    if (f.id === activeFolderId) li.classList.add('active')

    const syncingLabel = f.syncing ? ' <small style="color:var(--accent-teal); opacity:0.7;">(同步中...)</small>' : ''

    li.innerHTML = `
      <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${f.title}${syncingLabel}</span>
      <span class="badge">${f.count || 0}</span>
    `

    li.addEventListener('click', async () => {
      document.querySelectorAll('#folders-list li').forEach(el => el.classList.remove('active'))
      li.classList.add('active')
      try {
        const state = await window.api.getState()
        selectFolder(f.id, state.documents[f.id] || [])
      } catch(e) {
        selectFolder(f.id, [])
      }
    })
    ul.appendChild(li)
  })
}

function selectFolder(id, docs) {
  activeFolderId = id
  renderDocs(docs)
}

// ─── Doc Render ───────────────────────────────────────────────
function buildFileTree(docs) {
  const tree = { name: 'root', type: 'folder', children: {}, path: '' }
  
  docs.forEach(doc => {
    const cleanPath = doc.path.startsWith('/') ? doc.path.slice(1) : doc.path
    const parts = cleanPath.split('/')
    
    let current = tree
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1
      if (isFile) {
        current.children[part] = { ...doc, name: doc.title, type: 'file' }
      } else {
        if (!current.children[part]) {
          current.children[part] = { 
            name: part, 
            type: 'folder', 
            children: {}, 
            path: parts.slice(0, index + 1).join('/') 
          }
        }
        current = current.children[part]
      }
    })
  })
  return tree
}

function renderDocs(docs) {
  const container = document.getElementById('docs-list')
  if (!container) return
  container.innerHTML = ''

  if (!docs || docs.length === 0) {
    container.innerHTML = '<li class="empty-state">尚無文件<br>點選上方 ↑ 上傳</li>'
    return
  }

  const tree = buildFileTree(docs)
  
  function createTreeUI(node, depth = 0) {
    const ul = document.createElement('ul')
    ul.className = depth === 0 ? 'tree-root' : 'tree-sub'
    
    // Sort children: folders first, then files
    const sortedKeys = Object.keys(node.children || {}).sort((a, b) => {
      const nodeA = node.children[a]
      const nodeB = node.children[b]
      if (nodeA.type === nodeB.type) return a.localeCompare(b)
      return nodeA.type === 'folder' ? -1 : 1
    })

    sortedKeys.forEach(key => {
      const child = node.children[key]
      const li = document.createElement('li')
      li.className = `tree-item ${child.type === 'folder' ? 'is-folder' : 'is-file'}`
      if (child.type === 'folder') li.classList.add('expanded')
      
      const row = document.createElement('div')
      row.className = 'tree-row'
      row.style.paddingLeft = `${depth * 14 + 10}px`
      
      const icon = child.type === 'folder' ? '📁' : '📄'
      const label = child.type === 'file' ? child.title : key
      
      row.innerHTML = `
        <span class="tree-icon">${icon}</span>
        <span class="tree-label" title="${label}">${label}</span>
      `

      if (child.type === 'folder') {
        li.appendChild(row)
        li.appendChild(createTreeUI(child, depth + 1))
        
        row.addEventListener('click', (e) => {
          e.stopPropagation()
          li.classList.toggle('expanded')
        })
      } else {
        li.appendChild(row)
        row.addEventListener('click', () => {
          document.querySelectorAll('.tree-row').forEach(el => el.classList.remove('active'))
          row.classList.add('active')
          loadAndPreviewDocument(child)
        })
      }
      ul.appendChild(li)
    })
    return ul
  }

  container.appendChild(createTreeUI(tree))
}

// ─── Delete ───────────────────────────────────────────────────
async function handleDeleteFile(doc) {
  if (!activeFolderId) return
  if (!confirm(`確定要刪除「${doc.title}」嗎？此動作無法復原。`)) return

  try {
    const result = await window.api.deleteFile(activeFolderId, doc.id)
    if (result.success) {
      await loadState()
      
      // Clear viewer if the deleted doc was being viewed
      const viewerContent = document.getElementById('viewer-content')
      if (viewerContent.innerHTML.includes(doc.title)) {
        viewerContent.innerHTML = '<div class="empty-viewer">選擇文件以預覽</div>'
      }
    }
  } catch (err) {
    console.error('Delete failed:', err)
    alert('刪除失敗：' + err.message)
  }
}

// ─── Preview ──────────────────────────────────────────────────
async function loadAndPreviewDocument(doc) {
  const content = document.getElementById('viewer-content')
  content.innerHTML = '<div class="empty-viewer">正在從 P2P 磁碟抓取內容...</div>'

  try {
    const base64Str = await window.api.readFile(doc.path, doc.driveKey)
    const u8 = base64ToUint8(base64Str)
    
    if (doc.type === 'image') {
      const blob = new Blob([u8], { type: doc.mime || 'image/jpeg' })
      if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl)
      currentPdfUrl = URL.createObjectURL(blob)
      content.innerHTML = `<img src="${currentPdfUrl}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:6px;" />`
      return
    }

    if (doc.mime === 'application/pdf') {
      const blob = new Blob([u8], { type: 'application/pdf' })
      if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl)
      currentPdfUrl = URL.createObjectURL(blob)
      content.innerHTML = `<iframe src="${currentPdfUrl}#toolbar=0" style="width:100%; height:100%; border:none; border-radius:6px;"></iframe>`
      return
    }

    // --- HTML / Markdown Handling with Path Rewriting ---
    let text = new TextDecoder().decode(u8)
    let html = text
    let displayTitle = doc.title

    if (doc.mime === 'text/markdown') {
      const { metadata, content: mdBody } = parseFrontmatter(text)
      if (metadata.title) displayTitle = metadata.title
      html = simpleMarkdownToHtml(mdBody)
    }

    // 1. Path Rewriting: Identify ./assets/ and replace with P2P Blobs
    const assetMatches = [...html.matchAll(/src=["']\.\/assets\/(.*?)["']/g)]
    const blobMap = new Map()

    if (assetMatches.length > 0) {
      content.innerHTML = `<div class="empty-viewer">正在快取 ${assetMatches.length} 個 P2P 素材...</div>`
      
      const folderPath = doc.path.substring(0, doc.path.lastIndexOf('/'))
      
      await Promise.all(assetMatches.map(async (match) => {
        const filename = match[1]
        const assetPath = `${folderPath}/assets/${filename}`
        try {
          const b64 = await window.api.readFile(assetPath, doc.driveKey)
          const blob = new Blob([base64ToUint8(b64)])
          const bUrl = URL.createObjectURL(blob)
          blobMap.set(`./assets/${filename}`, bUrl)
        } catch (e) {
          console.warn('[Preview] Failed to load asset:', assetPath)
        }
      }))

      // Replace in HTML
      blobMap.forEach((bUrl, original) => {
        html = html.split(original).join(bUrl)
      })
    }

    // 2. Final Render in iframe with Style
    const gfmStyle = `
      <style>
        body { font-family: -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; padding: 40px; max-width: 800px; margin: 0 auto; background: #fff; }
        img { max-width: 100%; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin: 20px 0; display: block; }
        h1, h2, h3 { border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; margin-top: 24px; }
        .meta-header { font-size: 13px; color: #666; margin-bottom: 30px; padding-bottom: 15px; border-bottom: 2px solid #f0f0f0; }
        a { color: #0366d6; text-decoration: none; }
        code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; }
        blockquote { border-left: 4px solid #dfe2e5; color: #6a737d; margin: 0; padding-left: 1em; font-style: italic; }
        hr { height: 1px; background-color: #e1e4e8; border: 0; margin: 30px 0; }
      </style>
    `
    const headerHtml = `<div class="meta-header">🌐 原始標題：${displayTitle}<br>📅 擷取日期：${doc.date}</div>`
    
    const win = document.createElement('iframe')
    win.style.cssText = 'width:100%; height:100%; border:none; border-radius:6px; background:#fff;'
    content.innerHTML = ''
    content.appendChild(win)
    
    const docFrame = win.contentDocument || win.contentWindow.document
    docFrame.open()
    docFrame.write(gfmStyle + headerHtml + html)
    docFrame.close()

  } catch (err) {
    console.error(err)
    content.innerHTML = `<div class="empty-viewer">預覽失敗：${err.message}</div>`
  }
}

// --- Simplified GFM Parser ---
function simpleMarkdownToHtml(md) {
  return md
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/!\[(.*?)\]\((.*?)\)/gim, '<img alt="$1" src="$2" />')
    .replace(/[^\!]\[(.*?)\]\((.*?)\)/gim, '<a href="$2">$1</a>')
    .replace(/\n$/gim, '<br />')
    .replace(/\n/gim, '<p></p>')
}

// --- Frontmatter Parser ---
function parseFrontmatter(md) {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---/)
  const metadata = {}
  let content = md

  if (fmMatch) {
    const fmText = fmMatch[1]
    content = md.replace(fmMatch[0], '').trim()
    
    // Simple YAML-like parsing (key: value)
    fmText.split('\n').forEach(line => {
      const parts = line.split(':')
      if (parts.length >= 2) {
        const key = parts[0].trim()
        let val = parts.slice(1).join(':').trim()
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
        metadata[key] = val
      }
    })
  }
  return { metadata, content }
}

// ─── Upload ───────────────────────────────────────────────────
async function handleFileUpload(e) {
  if (!activeFolderId) return alert('請先選擇左側資料夾')
  const files = e.target.files
  if (!files || files.length === 0) return

  for (const file of files) {
    const buffer = await file.arrayBuffer()
    const b64 = bufferToBase64(buffer)

    await window.api.saveFile(activeFolderId, {
      name: file.name,
      type: file.type,
      base64: b64
    })
  }

  await loadState()
  e.target.value = ''
}

// ─── Clipper Settings ─────────────────────────────────────────
function setupClipperSettingsHandlers() {
  const openBtn = document.getElementById('open-folder-btn')
  const setBtn = document.getElementById('set-folder-btn')

  openBtn?.addEventListener('click', async () => {
    try {
      await window.api.openClippingsFolder()
    } catch (e) {
      alert('無法開啟資料夾：' + e.message)
    }
  })

  setBtn?.addEventListener('click', async () => {
    try {
      const currentPath = await window.api.getClipperPath()
      const newPath = await window.api.selectClipperFolder()
      if (newPath) {
        alert(`已成功更新存檔路徑：\n${newPath}`)
      }
    } catch (e) {
      alert('設定失敗：' + e.message)
    }
  })

  // P2P Sync (Dropbox style)
  const syncBtn = document.getElementById('set-sync-folder-btn')
  const syncStatus = document.getElementById('sync-status')

  const updateSyncUI = async () => {
    const path = await window.api.getSyncPath()
    if (path) {
      syncStatus.textContent = `同步中: ...${path.slice(-20)}`
      syncStatus.title = path
    }
  }

  updateSyncUI()

  syncBtn?.addEventListener('click', async () => {
    try {
      const newPath = await window.api.selectSyncFolder()
      if (newPath) {
        alert(`P2P 同步資料夾已設定：\n${newPath}\n\n現在您可以直接在該資料夾管理檔案！`)
        updateSyncUI()
      }
    } catch (e) {
      alert('同步設定失敗：' + e.message)
    }
  })
}
