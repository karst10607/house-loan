document.getElementById('clip-btn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.textContent = 'Scanning assets...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 1. Extract DOM and image URLs
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Find all images and resolve their full URLs
        const imgs = Array.from(document.querySelectorAll('img')).map(img => img.src).filter(src => src && src.startsWith('http'));
        const uniqueImgs = [...new Set(imgs)]; // Remove duplicates
        
        return {
          html: document.documentElement.outerHTML,
          title: document.title,
          url: window.location.href,
          imageUrls: uniqueImgs
        };
      }
    });

    const { html, title, url, imageUrls } = results[0].result;
    const assets = [];

    // 2. Fetch images in the extension (bypasses most CORS)
    status.textContent = `Downloading ${imageUrls.length} images...`;
    
    for (let i = 0; i < imageUrls.length; i++) {
        const imgUrl = imageUrls[i];
        try {
            const resp = await fetch(imgUrl);
            const blob = await resp.blob();
            
            // Convert to base64 to send over JSON
            const reader = new FileReader();
            const b64 = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(blob);
            });

            // Extract filename from URL or use a hash
            const filename = imgUrl.split('/').pop().split('?')[0] || `img-${i}.jpg`;
            
            assets.push({
                originalUrl: imgUrl,
                filename: filename.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? filename : `${filename}.jpg`,
                base64: b64
            });
            status.textContent = `Down: ${i+1}/${imageUrls.length}...`;
        } catch (e) {
            console.warn('Failed to fetch image:', imgUrl, e);
        }
    }

    // 3. Send to Electron
    status.textContent = 'Uploading to P2P App...';
    const response = await fetch('http://127.0.0.1:44123/api/clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, url, html, assets })
    });

    if (response.ok) {
      status.textContent = 'Success! Saved Assets.';
    } else {
      const errText = await response.text();
      status.textContent = 'Error: ' + errText;
    }
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  }
});
