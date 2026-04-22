// ============================================================
// Knowledge Hub Clipper — Popup Logic v2.0
// ============================================================

const state = {
    title: '',
    url: '',
    html: '',
    imageUrls: [],
    mode: 'auto' // 'auto' | 'select'
};

let currentTab = null;

// ---- UI Refs ----
const statusEl = document.getElementById('status');
const titleEl = document.getElementById('preview-title');
const imgEl = document.getElementById('img-count');
const charEl = document.getElementById('char-count');
const clipBtn = document.getElementById('clip-btn');
const selectBtn = document.getElementById('select-btn');
const fullpageBtn = document.getElementById('fullpage-btn');
const modeIndicator = document.getElementById('mode-indicator');
const selectionCount = document.getElementById('selection-count');

// ---- 1. On Load: Gather basic page info ----
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        currentTab = tab;
        state.url = tab.url;
        state.title = tab.title;

        titleEl.textContent = state.title;
        imgEl.textContent = '📸 點選按鈕剪輯';
        charEl.textContent = `📄 ${state.title.slice(0, 30)}`;
        statusEl.textContent = '選擇剪輯模式';

        fullpageBtn.disabled = false;
        selectBtn.disabled = false;
    } catch (err) {
        statusEl.textContent = '錯誤: ' + err.message;
    }
});

// ---- 2. Select Mode ----
selectBtn.addEventListener('click', async () => {
    if (!currentTab) return;

    // Toggle off
    if (state.mode === 'select') {
        state.mode = 'auto';
        selectBtn.classList.remove('active');
        modeIndicator.classList.remove('visible');
        selectionCount.classList.remove('visible');
        clipBtn.disabled = true;
        statusEl.textContent = '選取模式已關閉';
        // Cancel the selector in-page
        await chrome.scripting.executeScript({
            target: { tabId: currentTab.id },
            func: () => {
                const btn = document.getElementById('__kh-cancel-btn');
                if (btn) btn.click();
            }
        });
        return;
    }

    state.mode = 'select';
    selectBtn.classList.add('active');
    modeIndicator.classList.add('visible');
    selectionCount.classList.remove('visible');
    clipBtn.disabled = true;
    statusEl.textContent = '框選模式啟動 — 請切換到頁面';

    // Inject the content script
    await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ['content-script.js']
    });

    // Poll for the result from the page
    pollForSelection();
});

// ---- Poll page for selection result ----
async function pollForSelection() {
    const interval = setInterval(async () => {
        if (state.mode !== 'select') {
            clearInterval(interval);
            return;
        }

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                func: () => window.__khGetResult ? window.__khGetResult() : null
            });

            const result = results[0]?.result;
            if (!result) {
                // Still selecting, update count
                const countResults = await chrome.scripting.executeScript({
                    target: { tabId: currentTab.id },
                    func: () => window.__khSelectorActive ? 
                        (document.querySelectorAll('.__kh-selected').length) : -1
                });
                const count = countResults[0]?.result;
                if (count >= 0) {
                    selectionCount.textContent = `✅ 已選 ${count} 個區塊`;
                    selectionCount.classList.add('visible');
                }
                return;
            }

            clearInterval(interval);
            state.mode = 'auto';
            selectBtn.classList.remove('active');
            modeIndicator.classList.remove('visible');

            if (result.cancelled) {
                selectionCount.classList.remove('visible');
                statusEl.textContent = '選取已取消';
                clipBtn.disabled = true;
                return;
            }

            // Got clean selection!
            state.html = result.html;
            state.imageUrls = result.imageUrls;
            const imgCount = result.imageUrls.length;
            const charKb = (result.html.length / 1024).toFixed(1);

            selectionCount.textContent = `✅ 已選取內容 — ${charKb} KB, ${imgCount} 張圖片`;
            selectionCount.classList.add('visible');
            imgEl.textContent = `📸 ${imgCount} 張圖片`;
            charEl.textContent = `📄 ${charKb} KB`;
            statusEl.textContent = '準備儲存！';
            clipBtn.disabled = false;

        } catch (e) {
            clearInterval(interval);
            state.mode = 'auto';
            statusEl.textContent = '輪詢錯誤: ' + e.message;
        }
    }, 800);
}

// ---- 3. Full-Page Auto-Extract (smart extraction) ----
fullpageBtn.addEventListener('click', async () => {
    if (!currentTab) return;
    fullpageBtn.disabled = true;
    statusEl.textContent = '正在提取主要內容...';

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: currentTab.id },
            func: () => {
                // Trigger lazy-load images
                document.querySelectorAll('img[data-src], img[data-original], img[loading="lazy"]').forEach(img => {
                    const lazySrc = img.dataset.original || img.dataset.src;
                    if (lazySrc) img.setAttribute('src', lazySrc);
                });

                // Smart main content detection
                const candidates = [
                    document.querySelector('article'),
                    document.querySelector('[role="main"]'),
                    document.querySelector('main'),
                    document.querySelector('.post-content'),
                    document.querySelector('.article-body'),
                    document.querySelector('.entry-content'),
                    document.querySelector('#content'),
                    document.querySelector('.content'),
                    document.body
                ];
                const mainEl = candidates.find(el => el !== null) || document.body;

                // Clone and clean
                const clone = mainEl.cloneNode(true);
                clone.querySelectorAll('script, style, link, svg, noscript, iframe, nav, header, footer, [aria-hidden="true"]').forEach(el => el.remove());
                clone.querySelectorAll('*').forEach(el => {
                    [...el.attributes].forEach(attr => {
                        if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
                    });
                });

                // Collect real image URLs (no base64)
                const imageUrls = new Set();
                mainEl.querySelectorAll('img').forEach(img => {
                    const src = img.getAttribute('src') || '';
                    if (!src.startsWith('data:') && src) {
                        try { imageUrls.add(new URL(src, document.baseURI).href); } catch(e) {}
                    }
                });

                // Fix image srcs in clone
                clone.querySelectorAll('img').forEach(img => {
                    const src = img.getAttribute('src') || '';
                    if (src.startsWith('data:')) { img.remove(); return; }
                    try { img.setAttribute('src', new URL(src, document.baseURI).href); } catch(e) {}
                });

                return {
                    html: clone.innerHTML,
                    imageUrls: [...imageUrls]
                };
            }
        });

        const res = results[0].result;
        state.html = res.html;
        state.imageUrls = res.imageUrls;

        const charKb = (res.html.length / 1024).toFixed(1);
        imgEl.textContent = `📸 ${res.imageUrls.length} 張圖片`;
        charEl.textContent = `📄 ${charKb} KB`;
        statusEl.textContent = `主文提取完成，${charKb} KB`;
        clipBtn.disabled = false;

    } catch (err) {
        statusEl.textContent = '提取錯誤: ' + err.message;
        fullpageBtn.disabled = false;
    }
});

// ---- 4. Clip Button — Send to backend ----
clipBtn.addEventListener('click', async () => {
    if (!state.html) {
        statusEl.textContent = '請先選取內容！';
        return;
    }
    clipBtn.disabled = true;
    statusEl.textContent = '儲存中...';

    try {
        const response = await fetch('http://127.0.0.1:44123/api/clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: state.title,
                url: state.url,
                html: state.html,
                imageUrls: state.imageUrls
            })
        });

        if (response.ok) {
            const result = await response.json();
            statusEl.textContent = `✅ 已儲存！下載 ${result.imageCount || 0} 張圖片`;
            selectionCount.classList.remove('visible');
            setTimeout(() => window.close(), 2000);
        } else {
            statusEl.textContent = '錯誤: ' + await response.text();
            clipBtn.disabled = false;
        }
    } catch (err) {
        statusEl.textContent = '錯誤 (後端離線?): ' + err.message;
        clipBtn.disabled = false;
    }
});
