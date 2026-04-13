/* Electron Renderer Process */

// ─── App version ─────────────────────────────────────────────
const APP_VERSION = '1.11.0-electron'

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
// I'll use multi_replace if needed but let's see where onStateUpdate is


// ─── Folder Render ────────────────────────────────────────────
function renderFolders(folders) {
  const ul = document.getElementById('folders-list')
  if (!ul) return
  
  // To avoid flickering, we can check if content changed, 
  // but for this scale, direct re-render is usually fine.
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
function renderDocs(docs) {
  const ul = document.getElementById('docs-list')
  if (!ul) return
  ul.innerHTML = ''

  if (!docs || docs.length === 0) {
    ul.innerHTML = '<li class="empty-state">尚無文件<br>點選上方 ↑ 上傳</li>'
    return
  }

  docs.forEach(doc => {
    const li = document.createElement('li')
    const typeClass = doc.type === 'pdf' ? 'type-pdf' : 'type-img'
    
    // Only show delete button for non-remote documents
    const deleteBtnHtml = !doc.remote ? `
      <div class="doc-actions">
        <button class="doc-delete-btn" title="刪除檔案">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>` : ''

    li.innerHTML = `
      <div class="doc-info">
        <span class="doc-title">${doc.title}</span>
        <span class="doc-date">${doc.date}</span>
      </div>
      <span class="doc-type ${typeClass}">${doc.type.toUpperCase()}</span>
      ${deleteBtnHtml}
    `
    
    li.addEventListener('click', () => loadAndPreviewDocument(doc))
    
    // Setup delete event
    const delBtn = li.querySelector('.doc-delete-btn')
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation() // Don't trigger preview
        handleDeleteFile(doc)
      })
    }
    
    ul.appendChild(li)
  })
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
  content.innerHTML = '<div class="empty-viewer">載入中...</div>'

  try {
    const base64Str = await window.api.readFile(doc.path, doc.driveKey)
    const u8 = base64ToUint8(base64Str)
    const blob = new Blob([u8], { type: doc.mime || 'application/pdf' })

    if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl)
    currentPdfUrl = URL.createObjectURL(blob)

    if (doc.type === 'image') {
      content.innerHTML = `<img src="${currentPdfUrl}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:6px;" />`
    } else {
      content.innerHTML = `<iframe src="${currentPdfUrl}#toolbar=0" style="width:100%; height:100%; border:none; border-radius:6px;"></iframe>`
    }
  } catch (err) {
    console.error(err)
    content.innerHTML = `<div class="empty-viewer">預覽失敗：${err.message}</div>`
  }
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
