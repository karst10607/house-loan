const state = {
  title: '',
  url: '',
  html: '',
  imageUrls: []
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
                // Trigger lazy-load images before extraction
                document.querySelectorAll('img[data-src], img[data-original], img[loading="lazy"]').forEach(img => {
                    const lazySrc = img.dataset.original || img.dataset.src;
                    if (lazySrc) img.setAttribute('src', lazySrc);
                });

                // Gather all absolute image URLs from the full page
                const images = [];
                document.querySelectorAll('img').forEach(img => {
                    const src = img.getAttribute('src');
                    if (src && !src.startsWith('data:')) {
                        try {
                            const abs = new URL(src, document.baseURI).href;
                            images.push(abs);
                        } catch (e) {}
                    }
                });

                return {
                    title: document.title,
                    // Send the full page HTML — server's defuddle does the smart extraction
                    html: document.documentElement.outerHTML,
                    imageUrls: [...new Set(images)]
                };
            }
        });

        const res = results[0].result;
        state.title = res.title;
        state.html = res.html;
        state.imageUrls = res.imageUrls;

        // Update UI
        titleEl.textContent = state.title;
        imgEl.textContent = `📸 ${state.imageUrls.length} images`;
        charEl.textContent = `📄 ${(res.html.length / 1024).toFixed(1)} KB`;
        
        clipBtn.disabled = false;
        status.textContent = 'Ready to save.';
    } catch (err) {
        status.textContent = 'Error: ' + err.message;
    }
});

// 2. Handle Clipping — no more base64 downloads here!
document.getElementById('clip-btn').addEventListener('click', async () => {
    const status = document.getElementById('status');
    const clipBtn = document.getElementById('clip-btn');
    clipBtn.disabled = true;
    
    try {
        status.textContent = 'Saving...';

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
            status.textContent = `✅ Saved! ${result.imageCount || 0} images queued.`;
            setTimeout(() => window.close(), 1500);
        } else {
            status.textContent = 'Error: ' + await response.text();
            clipBtn.disabled = false;
        }
    } catch (err) {
        status.textContent = 'Error (App offline?): ' + err.message;
        clipBtn.disabled = false;
    }
});

function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[<>:"/\\|?*]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 50);
}
