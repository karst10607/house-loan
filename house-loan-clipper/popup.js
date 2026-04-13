document.getElementById('clip-btn').addEventListener('click', async () => {
    const status = document.getElementById('status');
    status.textContent = 'Clipping...';
  
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Extract page content
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return {
            html: document.documentElement.outerHTML,
            title: document.title,
            url: window.location.href
          };
        }
      });
  
      const { html, title, url } = results[0].result;
  
      // Send to Electron
      const response = await fetch('http://127.0.0.1:44123/api/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, url, html,
          assets: [] // Phase 2: Add image extraction logic
        })
      });
  
      if (response.ok) {
        status.textContent = 'Saved to P2P Library!';
      } else {
        status.textContent = 'Error: ' + response.statusText;
      }
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
    }
  });
