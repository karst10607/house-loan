const state = {
  title: '',
  url: '',
  markdown: '',
  imageUrls: [],
  assets: []
};

// 1. Initial Analysis on Load
document.addEventListener('DOMContentLoaded', async () => {
    const status = document.getElementById('status');
    const titleEl = document.getElementById('preview-title');
    const imgEl = document.getElementById('img-count');
    const charEl = document.getElementById('char-count');
    const clipBtn = document.getElementById('clip-btn');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        state.url = tab.url;

        status.textContent = 'Analyzing content...';
        
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                // --- Smart Extraction Heuristics ---
                const findMainElement = () => {
                    const candidates = document.querySelectorAll('article, main, .post, .entry, .article-body, #content');
                    if (candidates.length > 0) return candidates[0];

                    // Fallback: Find div with most <p> tags
                    let best = document.body;
                    let maxP = 0;
                    document.querySelectorAll('div, section').forEach(el => {
                        const pCount = el.querySelectorAll('p').length;
                        if (pCount > maxP) { maxP = pCount; best = el; }
                    });
                    return best;
                };

                const mainEl = findMainElement().cloneNode(true);
                
                // Cleanup: remove scripts, styles, navs, footers
                mainEl.querySelectorAll('script, style, nav, footer, header, ads, .sidebar').forEach(el => el.remove());

                // Resolve Images
                const images = [];
                mainEl.querySelectorAll('img').forEach(img => {
                    const src = img.dataset.original || img.dataset.src || img.getAttribute('src');
                    if (src) {
                        const abs = new URL(src, document.baseURI).href;
                        img.setAttribute('src', abs); // Force absolute for MD match
                        images.push(abs);
                    }
                });

                return {
                    title: document.title,
                    html: mainEl.innerHTML,
                    imageUrls: [...new Set(images)]
                };
            }
        });

        const res = results[0].result;
        state.title = res.title;
        state.imageUrls = res.imageUrls;
        
        // Convert to Simple Markdown with Frontmatter
        state.markdown = htmlToMarkdown(res.html, state.url, state.title);

        // Update UI
        titleEl.textContent = state.title;
        imgEl.textContent = `📸 ${state.imageUrls.length} images`;
        charEl.textContent = `📄 ${state.markdown.length} chars`;
        
        clipBtn.disabled = false;
        status.textContent = 'Ready to save.';
    } catch (err) {
        status.textContent = 'Error: ' + err.message;
    }
});

// 2. Handle Clipping
document.getElementById('clip-btn').addEventListener('click', async () => {
    const status = document.getElementById('status');
    const clipBtn = document.getElementById('clip-btn');
    clipBtn.disabled = true;
    
    try {
        status.textContent = `Downloading ${state.imageUrls.length} assets...`;
        
        const assets = [];
        for (let i = 0; i < state.imageUrls.length; i++) {
            const url = state.imageUrls[i];
            try {
                const resp = await fetch(url);
                if (!resp.ok) continue;
                const blob = await resp.blob();
                const b64 = await blobToBase64(blob);

                const rawFilename = url.split('/').pop().split('?')[0] || `img-${i}.jpg`;
                const filename = rawFilename.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? rawFilename : `${rawFilename}.jpg`;
                
                assets.push({ originalUrl: url, filename, base64: b64 });
                status.textContent = `Assets: ${i+1}/${state.imageUrls.length}...`;
            } catch (e) {
                console.warn('[Clipper] Skip:', url);
            }
        }

        status.textContent = 'Syncing to P2P Bridge...';
        const response = await fetch('http://127.0.0.1:44123/api/clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: state.title,
                url: state.url,
                markdown: state.markdown,
                assets: assets
            })
        });

        if (response.ok) {
            status.textContent = 'Success! Saved to Brain.';
            setTimeout(() => window.close(), 1500);
        } else {
            status.textContent = 'Sync Error: ' + await response.text();
            clipBtn.disabled = false;
        }
    } catch (err) {
        status.textContent = 'Error: ' + err.message;
        clipBtn.disabled = false;
    }
});

// --- Helpers ---

function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove non-word chars except space/hyphen
        .trim()
        .replace(/\s+/g, '-')     // Space to hyphen
        .replace(/-+/g, '-')      // Reduce multiple hyphens
        .slice(0, 50);            // Limit length
}

function htmlToMarkdown(html, baseUrl, title) {
    let md = html
        .replace(/<h1.*?>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
        .replace(/<h2.*?>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
        .replace(/<strong.*?>([\s\S]*?)<\/strong>/gi, '**$1**')
        .replace(/<b.*?>([\s\S]*?)<\/b>/gi, '**$1**')
        .replace(/<p.*?>([\s\S]*?)<\/p>/gi, '$1\n\n')
        .replace(/<br.*?>/gi, '\n')
        .replace(/<img.*?src=["'](.*?)["'].*?>/gi, (match, src) => {
            const filename = src.split('/').pop().split('?')[0] || 'image.jpg';
            return `\n![${filename}](./assets/${filename})\n`;
        })
        .replace(/<a.*?href=["'](.*?)["'].*?>([\s\S]*?)<\/a>/gi, '[$2]($1)')
        .replace(/<.*?>/g, ''); // Strip remaining tags

    const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
url: "${baseUrl}"
date: "${new Date().toISOString()}"
type: "clipping"
---

`;

    return frontmatter + md.trim();
}

async function blobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
    });
}
