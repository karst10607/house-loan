# Honoka Lite Changelog

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
