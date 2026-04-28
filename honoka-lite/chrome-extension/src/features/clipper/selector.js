// ============================================================
// Knowledge Hub Clipper — Visual Selector Content Script
// Injected into the target page when "選取區塊" is clicked.
// ============================================================

(function () {
    // Prevent double-injection
    if (window.__khSelectorActive) return;
    window.__khSelectorActive = true;

    const selectedNodes = new Set();
    let hoveredEl = null;

    // ---- Styles ----
    const style = document.createElement('style');
    style.id = '__kh-selector-style';
    style.textContent = `
        .__kh-hover {
            outline: 2px dashed #e94560 !important;
            outline-offset: 3px !important;
            background: rgba(233, 69, 96, 0.06) !important;
            cursor: crosshair !important;
        }
        .__kh-selected {
            outline: 2px solid #2dd4bf !important;
            outline-offset: 3px !important;
            background: rgba(45, 212, 191, 0.08) !important;
        }
        #__kh-toolbar {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2147483647;
            background: #1a1a2e;
            border: 1px solid rgba(45,212,191,0.4);
            border-radius: 50px;
            padding: 10px 20px;
            display: flex;
            gap: 12px;
            align-items: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #e8e8f0;
            font-size: 13px;
        }
        #__kh-toolbar span { color: #2dd4bf; font-weight: 700; }
        #__kh-toolbar button {
            padding: 6px 16px;
            border: none;
            border-radius: 50px;
            cursor: pointer;
            font-weight: 700;
            font-size: 12px;
        }
        #__kh-confirm-btn { background: #2dd4bf; color: #000; }
        #__kh-confirm-btn:hover { background: #24b09e; }
        #__kh-cancel-btn { background: rgba(255,255,255,0.1); color: #e8e8f0; }
        #__kh-cancel-btn:hover { background: rgba(255,255,255,0.2); }
        #__kh-clear-btn { background: rgba(233,69,96,0.2); color: #e94560; }
        #__kh-clear-btn:hover { background: rgba(233,69,96,0.35); }
    `;
    document.head.appendChild(style);

    // ---- Toolbar ----
    const toolbar = document.createElement('div');
    toolbar.id = '__kh-toolbar';
    toolbar.innerHTML = `
        <span id="__kh-count">0 個區塊已選取</span>
        <button id="__kh-clear-btn">✖ 清除</button>
        <button id="__kh-cancel-btn">取消</button>
        <button id="__kh-confirm-btn">✅ 確認並剪輯</button>
    `;
    document.body.appendChild(toolbar);

    // ---- Helper: Update count ----
    function updateCount() {
        document.getElementById('__kh-count').textContent = `${selectedNodes.size} 個區塊已選取`;
    }

    // ---- Events ----
    function onMouseOver(e) {
        const el = e.target;
        if (el.id && el.id.startsWith('__kh') || el.closest('#__kh-toolbar')) return;
        
        e.stopPropagation();
        if (hoveredEl && hoveredEl !== el) {
            hoveredEl.classList.remove('__kh-hover');
        }
        if (!selectedNodes.has(el)) {
            el.classList.add('__kh-hover');
        }
        hoveredEl = el;
    }

    function onMouseOut(e) {
        const el = e.target;
        if (!selectedNodes.has(el)) {
            el.classList.remove('__kh-hover');
        }
    }

    function onClick(e) {
        const el = e.target;
        if (el.id && el.id.startsWith('__kh') || el.closest('#__kh-toolbar')) return;

        e.preventDefault();
        e.stopPropagation();

        if (selectedNodes.has(el)) {
            selectedNodes.delete(el);
            el.classList.remove('__kh-selected');
            el.classList.add('__kh-hover');
        } else {
            selectedNodes.add(el);
            el.classList.remove('__kh-hover');
            el.classList.add('__kh-selected');
        }
        updateCount();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            destroy();
            window.__khSelectionResult = { cancelled: true };
        }
    }

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);

    // ---- Clean a DOM node ----
    function cleanNode(node) {
        const clone = node.cloneNode(true);
        // Remove junk elements
        clone.querySelectorAll('script, style, link, svg, noscript, iframe, [aria-hidden="true"]').forEach(el => el.remove());
        // Remove data: images (base64)
        clone.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src') || '';
            if (src.startsWith('data:')) {
                img.remove();
            } else {
                // Make src absolute
                try {
                    img.setAttribute('src', new URL(src, document.baseURI).href);
                } catch(e) {}
            }
        });
        // Remove all event attributes & inline styles
        clone.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(attr => {
                if (attr.name.startsWith('on') || attr.name === 'style') {
                    el.removeAttribute(attr.name);
                }
            });
        });
        return clone.innerHTML;
    }

    // ---- Cleanup function ----
    function destroy() {
        document.removeEventListener('mouseover', onMouseOver, true);
        document.removeEventListener('mouseout', onMouseOut, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        selectedNodes.forEach(el => {
            el.classList.remove('__kh-hover', '__kh-selected');
        });
        if (hoveredEl) hoveredEl.classList.remove('__kh-hover');
        toolbar.remove();
        style.remove();
        window.__khSelectorActive = false;
    }

    // ---- Toolbar Buttons ----
    document.getElementById('__kh-cancel-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        destroy();
        // Notify popup that selection was cancelled
        window.__khSelectionResult = { cancelled: true };
    });

    document.getElementById('__kh-clear-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        selectedNodes.forEach(el => {
            el.classList.remove('__kh-selected');
        });
        selectedNodes.clear();
        updateCount();
    });

    document.getElementById('__kh-confirm-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedNodes.size === 0) {
            alert('請先點選至少一個內容區塊！');
            return;
        }

        // Gather clean HTML from each selected node
        const cleanedParts = [];
        const imageUrls = new Set();

        selectedNodes.forEach(el => {
            const html = cleanNode(el);
            cleanedParts.push(html);
            // Also collect image URLs from the original element
            el.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src') || '';
                if (!src.startsWith('data:') && src) {
                    try {
                        imageUrls.add(new URL(src, document.baseURI).href);
                    } catch(e) {}
                }
            });
        });

        const result = {
            html: cleanedParts.join('\n\n'),
            imageUrls: [...imageUrls],
            cancelled: false
        };

        destroy();

        // Store result for popup to pick up
        window.__khSelectionResult = result;
    });

    // Expose a polling mechanism for popup
    window.__khGetResult = function () {
        return window.__khSelectionResult || null;
    };

})();
