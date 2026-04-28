# Honoka Lite Changelog

## v1.3.5

### Features
- **Live Download Progress**: The Telegram bot now shows real-time percentage updates when downloading videos via `yt-dlp`.
- **Throttled Updates**: Progress updates are throttled to every 3 seconds to stay within Telegram API rate limits.

## v1.3.4

### Features
- **Universal Video Downloader**: Expanded video capture to support **Google Drive**, YouTube, Bilibili, and more via `yt-dlp`.
- **Bypass Restrictions**: Capable of downloading Google Drive videos even when the "Download" button is disabled by the owner (for shared/public links).

## v1.3.3

### Features
- **System Capability Detection**: The Dashboard now checks for the presence of `yt-dlp` and `ffmpeg` and provides installation guides if missing.
- **Improved UI**: Cleaned up the Bridge Dashboard for better visibility of system status.

## v1.3.2

### Features
- **X (Twitter) Video Downloader**: Integrated `yt-dlp` to download high-quality videos from X/Twitter without needing the official API.
- **Automatic Video Archiving**: Videos are saved to `Inbound_Videos` with a corresponding `.md` sidecar file for indexing.

## v1.3.1

### Fixes
- **Build Pipeline**: Fixed incorrect paths in GitHub Actions workflow to ensure cross-platform binaries are generated correctly.
- **Improved Distribution**: Release assets now come in organized `.zip` files containing both the **Honoka Bridge** binary and the **Chrome Extension** folder for easier setup.

## v1.3.0

### Features
- **Integrated Extension Shutdown**: Replaced the "Close" button in the Chrome Extension GUI with a real **"🛑 Shutdown"** button. You can now stop the background server directly from the extension.
(It's a hard reset on linux and mac)
## v1.2.9

### Fixes
- **Extension Compatibility**: Restored JSON response for `/status` endpoint to fix "Offline" status in Chrome Extension.
- **GUI Migration**: Moved the HTML Status Dashboard to the root route (`/`).

## v1.2.8

### Features
- **Remote Shutdown Dashboard**: Visiting `http://localhost:44124` now shows a beautiful web dashboard with a **"Shut Down Server"** button. This provides an easy way for users to exit the background process without using the Command Line or Task Manager.
- **Improved Windows Installer**: Updated `install-windows.bat` to leverage the v1.2.7 `--install` automation.

## v1.2.7

### Features
- **One-Click Portable Installation (Windows)**: Added a new `--install` command line flag for the compiled Honoka Bridge binary. 
  - Running `honoka-bridge.exe --install` will automatically register the Bridge to start silently in the background whenever Windows boots up.
  - This eliminates the need for manual `.vbs` creation or moving files to the Startup folder.
- **Improved Cross-Platform Binary Support**: Enhanced the binary build configuration to ensure that Node.js 20 features and ESM compatibility work perfectly inside the standalone `.exe` and macOS/Linux binaries.

## v1.2.6

### Bug Fixes & Stability
- **Fixed "Silent Crash" on Node 18 (ESM Compatibility)**: Resolved a critical issue where the Telegram bot failed to initialize on Linux systems running Node.js 18.x.
  - **Root Cause**: Recent updates to the `jsdom` dependency tree (specifically `html-encoding-sniffer`) moved to Pure ESM. In Node 18, using `require()` on these modules throws a fatal error that was previously crashing the bot's startup sequence.
  - **Fix**: Re-implemented dependency loading using "Lazy Dynamic Imports" (`await import()`). This allows the Bridge to load modern ESM dependencies safely even within a CommonJS environment on older Node versions.
- **Improved Startup Resilience**: Bot dependencies are now loaded on-demand, preventing the entire Bridge from failing if a single sub-dependency has a version conflict.
PS:My linux systemd for auto-restart is using older version of nodejs, but my terminial is running node 20, I just forced update them to the latest. But this fix can save others from the same problems. 

## v1.2.5

### Bug Fixes & Stability
- **Fixed Telegram Bot "Silent Hangs" (Linux Networking Patch)**: Resolved a critical issue where the Telegram bot would stop responding to messages despite the Bridge being online.
  - **Root Cause**: Node.js 18+ defaults to IPv6. On many Linux environments with incomplete IPv6 routing, the Bridge would attempt to connect to Telegram via IPv6 and "hang" for up to 30 seconds before failing. This caused `AggregateError` and `ETIMEDOUT` errors that blocked the message handler.
  - **Fix**: Implemented `dns.setDefaultResultOrder('ipv4first')` in the Bridge core. This forces the Bridge to prioritize IPv4, ensuring instant and reliable connectivity to Telegram and external websites on Linux, Mac, and Windows.

## v1.2.4

### Features
- **Auto-Sync Improvements**: The Honoka Library UI in the Chrome Extension now performs a full refresh every 15 seconds. This ensures that any content saved via the Telegram Bot or other background background background processes will automatically appear in your local document list without requiring a manual page reload.
- **Robustness Documentation**: Added a comprehensive guide in `doc2/honoka_robustness_guide.md` explaining the new multi-layered auto-restart strategy (systemd + Node cluster) for both Linux and Windows.

### Bug Fixes
- **Fixed UI Refresh Logic**: Corrected a bug in the extension's polling loop where only the sidebar was updated, leaving the main document table stale after background saves.

## v1.2.3

### Features
- **Dual-View Preview GUI**: Added a floating toggle switch to the Preview window, allowing you to seamlessly switch between the Original HTML and the converted Markdown view. By default, content clipped via the Telegram Bot prioritizes the HTML view to provide the best reading experience.

### Bug Fixes & Stability
- **Fixed Bridge Restart Reliability**: Resolved a critical issue where the Bridge would enter a "zombie state" and fail to restart correctly from the Chrome extension.
  - **Root Cause**: The addition of the Telegram Bot introduced a long-polling mechanism that kept a persistent connection open in the background. When the UI triggered `server.close()`, it only shut down the HTTP listener, leaving the long-polling loop active and preventing the Node process from dying cleanly.
  - **Fix**: Re-architected the `honoka-bridge` backend into a Node.js `cluster` architecture (Manager/Worker). Clicking "Restart" now performs a true process exit (`process.exit(0)`) on the worker, instantly killing any hanging long-polling connections, and allowing the Manager to securely spawn a fresh worker on the same port.
- **Fixed Telegram Bot `EFATAL` Crash Loops**: If your VPN dropped or the network hiccuped, the long-polling mechanism would encounter DNS resolution errors, flooding the bot with exceptions and crashing the entire bridge silently. The bot now gracefully detects `EFATAL` network exceptions and halts polling without tearing down the Bridge API.
