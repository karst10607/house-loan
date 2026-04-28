# Bridge Stability & Dual-View Preview Plan

## 1. The Bridge "Hanging Restart" Mystery

### Why did the Bridge start failing to restart only after adding the Telegram Bot?

**Before Telegram Integration:**
Earlier versions of the Honoka Bridge acted as a pure, stateless HTTP server. When you clicked "Restart" in the Chrome extension, the bridge simply called `server.close()`. Because there were no other active background tasks or open network connections, Node.js's event loop would empty immediately, the local port would free up, and the process could cleanly spawn a new version of itself.

**After Telegram Integration:**
The Telegram bot (`node-telegram-bot-api`) relies on a mechanism called **Long-Polling**. 
Instead of waiting for Telegram to send data, the Bridge opens a persistent HTTPS connection to Telegram's servers (`api.telegram.org`) and holds it open for 30 seconds at a time (`timeout: 30`). 

This introduced two catastrophic issues for the restart mechanism:
1. **The Zombie Event Loop**: When `server.close()` was called, it successfully stopped the local HTTP server (port 44124), but it **did not** stop the active outgoing long-polling connection to Telegram. Because an HTTPS request was still pending in the background, Node.js refused to exit. The Bridge became a "zombie" process—the HTTP server was dead, but the process lived on, locking the port and preventing the new instance from binding to `44124` (yielding `EADDRINUSE` errors).
2. **The `EFATAL` Crash Loop**: If the local network dropped or a VPN disconnected, the long-polling request would fail to resolve DNS (`EFATAL`). The bot library would panic, throwing continuous errors and attempting rapid retries. Because the Bridge was originally spawned silently in the background (`detached: true, stdio: 'ignore'`), all these errors were hidden. The bridge would crash, and the Chrome extension would turn "red" without any terminal logs to explain why.

### The Solution: Cluster Manager & Graceful Shutdown
To solve this once and for all, we restructured the backend:
- **Node `cluster` Manager**: Running `node index.js` now starts a "Manager" process that spawns the actual Bridge as a "Worker". 
- **Auto-Healing**: If the worker crashes (or gets an `EFATAL` network drop), the Manager instantly spawns a new one. The terminal stays alive to log errors.
- **Clean Restarts**: Clicking "Restart" now simply triggers `process.exit(0)` on the worker. The Manager sees the exit and spawns a fresh worker. The Telegram long-polling is instantly killed, ensuring no zombie processes are left behind.

---

## 2. Dual-View Preview (HTML vs Markdown) Implementation Plan

The goal is to allow the local Notion document preview to seamlessly toggle between the original captured HTML and the converted Markdown, prioritizing HTML for Telegram-sourced content.

### Backend Changes (`honoka-bridge/index.js`)
- **New Data Route**: A new `/preview-content` endpoint will serve the raw contents.
  - If `?format=html` is requested, it serves the saved `source.html` file.
  - If `?format=md` is requested, it reads `index.md` and generates minimal HTML (the current behavior).
- **Wrapper UI Route**: The existing `/preview` route will become a wrapper page. It will:
  1. Read the frontmatter of `index.md`.
  2. Determine default format: If `source: telegram`, default to `html`. Otherwise, default to `md`.
  3. Serve a GUI wrapper containing an iframe and a toggle switch.

### UI / GUI Design (The Preview Window)
Injecting raw, arbitrary HTML (from `source.html`) directly into our UI is dangerous—it can break styling or execute unwanted scripts. To handle this elegantly:

1. **Iframe Isolation**: The main preview window will consist of a 100% width/height `<iframe sandbox="allow-same-origin">`. The raw web page content will live entirely inside this safe sandbox.
2. **Floating Toggle Switch**: At the top-right corner of the window (outside the iframe), there will be a glassmorphism-styled toggle switch: 
   `[ 🌐 Original Web | 📝 Markdown ]`
3. **Smart Defaults**: When you click the 👁 Preview icon in the extension:
   - **Telegram Clips**: The iframe `src` automatically loads `/preview-content?format=html`, and the toggle highlights `Original Web`.
   - **Other Clips**: The iframe `src` loads `/preview-content?format=md`, and the toggle highlights `Markdown`.
4. **Instant Switching**: Clicking the toggle instantly swaps the `src` of the iframe, allowing you to flip between the raw website layout and the clean Markdown text without reloading the whole page.

### Next Steps
Once approved, we will:
1. Build the `/preview-content` and updated `/preview` routes in the Bridge.
2. Implement the floating UI toggle with CSS glassmorphism.
3. Verify that Telegram links open directly into the HTML preview.
