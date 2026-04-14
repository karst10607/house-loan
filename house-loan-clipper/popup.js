document.getElementById('clip-btn').addEventListener('click', async () => {
    const status = document.getElementById('status');
    status.textContent = 'Analyzing page structure...';
  
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // 1. Smart Asset Extraction (Handles Lazy Loading & Background Images)
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const images = [];
          
          // 1. Resolve and scan <img> tags (Priority: data-original / data-src > src)
          document.querySelectorAll('img').forEach(img => {
              const originalSrc = img.dataset.original || img.dataset.src || img.getAttribute('src');
              if (originalSrc) {
                  const absoluteUrl = new URL(originalSrc, document.baseURI).href;
                  if (absoluteUrl.startsWith('http')) {
                      // CRITICAL: Point the actual src in the DOM to the absolute URL
                      // This ensures that when we capture outerHTML, the paths match our download list.
                      img.setAttribute('src', absoluteUrl);
                      images.push(absoluteUrl);
                  }
              }
          });
          
          // 2. Scan elements with Background Images (Common for map thumbnails / UI)
          document.querySelectorAll('*').forEach(el => {
              const bg = window.getComputedStyle(el).backgroundImage;
              if (bg && bg !== 'none' && bg.startsWith('url')) {
                  const match = bg.match(/url\(["']?(.*?)["']?\)/);
                  if (match && match[1]) {
                      const absoluteUrl = new URL(match[1], document.baseURI).href;
                      if (absoluteUrl.startsWith('http')) images.push(absoluteUrl);
                  }
              }
          });
  
          return {
            html: document.documentElement.outerHTML, // This now contains absolute URLs for all <img>
            title: document.title,
            url: window.location.href,
            imageUrls: [...new Set(images)] // Dedup
          };
        }
      });
  
      const { html, title, url, imageUrls } = results[0].result;
      const assets = [];
  
      // 2. Fetch images in background to bypass CORS/Anti-leech
      status.textContent = `Capturing ${imageUrls.length} assets...`;
      
      for (let i = 0; i < imageUrls.length; i++) {
          const imgUrl = imageUrls[i];
          try {
              const resp = await fetch(imgUrl);
              if (!resp.ok) continue;
              const blob = await resp.blob();
              
              const reader = new FileReader();
              const b64 = await new Promise((resolve) => {
                  reader.onloadend = () => resolve(reader.result.split(',')[1]);
                  reader.readAsDataURL(blob);
              });
  
              const rawFilename = imgUrl.split('/').pop().split('?')[0] || `asset-${i}.jpg`;
              const filename = rawFilename.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? rawFilename : `${rawFilename}.jpg`;
              
              assets.push({
                  originalUrl: imgUrl,
                  filename: filename,
                  base64: b64
              });
              status.textContent = `Progress: ${i+1}/${imageUrls.length}...`;
          } catch (e) {
              console.warn('[Clipper] Skip failed asset:', imgUrl);
          }
      }
  
      // 3. Dispatch to P2P Bridge
      status.textContent = 'Syncing to P2P App...';
      const response = await fetch('http://127.0.0.1:44123/api/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url, html, assets })
      });
  
      if (response.ok) {
        status.textContent = 'Success! Assets Persisted.';
      } else {
        const errText = await response.text();
        status.textContent = 'Sync Error: ' + errText;
      }
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
    }
  });
