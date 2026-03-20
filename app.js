/* Pear Renderer Process */
const syncStatusEl = document.createElement('div')
syncStatusEl.id = 'pear-sync-status'
syncStatusEl.style.cssText = `
  position: fixed;
  bottom: 10px;
  right: 10px;
  background: rgba(0,0,0,0.7);
  color: #34d399;
  padding: 5px 10px;
  border-radius: 20px;
  font-size: 11px;
  z-index: 9999;
  pointer-events: none;
  backdrop-filter: blur(5px);
  border: 1px solid rgba(52, 211, 153, 0.3);
  display: flex;
  align-items: center;
  gap: 6px;
`
syncStatusEl.innerHTML = '<span class="status-dot"></span> <span class="status-text">Pear P2P Connected</span>'
document.body.appendChild(syncStatusEl)

// Update sync status if Pear is available
if (typeof Pear !== 'undefined') {
  try {
    const updateStatus = async () => {
      const { app } = await Pear.versions()
      syncStatusEl.querySelector('.status-text').textContent = `v${app.fork}.${app.length} · P2P Synced`
    }
    updateStatus()
    setInterval(updateStatus, 5000)
  } catch (e) {
    console.error('Pear version check failed', e)
  }
}
