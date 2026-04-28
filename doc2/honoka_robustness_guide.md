# Honoka Robustness & Auto-Restart Architecture

Honoka Lite is designed to be highly resilient and cross-platform. To achieve this, it uses a multi-layered auto-restart strategy.

## 1. The Strategy: Outer vs. Inner Shield

The "Robustness" of the Bridge comes from two layers of protection:

### The "Outer Shield" (OS Level)
- **Linux (`systemd`)**: On Linux, the Bridge is registered as a background service. It is configured with `Restart=always`. This ensures the Bridge starts automatically when the computer boots up.
- **macOS (`LaunchAgent`)**: Similarly on Mac, it uses a LaunchAgent to ensure it starts on login.
- **Windows**: On Windows, it currently relies on manual execution or a `.bat` loop.

### The "Inner Shield" (Application Level - NEW)
As of **v1.2.3**, the Bridge implements a native Node.js `cluster` manager. 
- **The Manager**: A small, lightweight parent process that monitors the Bridge.
- **The Worker**: The actual Bridge server handling requests and the Telegram Bot.

**Why this matters:**
If the Telegram Bot encounters a network error (like a VPN drop) or the Bridge crashes internally:
1. Only the **Worker** dies.
2. The **Manager** instantly detects the exit and spawns a fresh Worker in 1.5 seconds.
3. Because the Manager never dies, the "Outer Shield" (like `systemd`) never sees a crash. This prevents Linux from hitting "Crash Rate Limits" and permanently disabling the service.

---

## 2. Cross-Platform Benefits

### Linux
The combination of `systemd` + `cluster` manager makes the Bridge nearly indestructible. Even if the Telegram API throws recursive errors, the background service stays active and the Chrome Extension stays "green."

### Windows
Even without `systemd`, simply running `node index.js` in a command prompt now provides auto-restart capability. If the bot crashes, the CMD window will stay open and the Manager will automatically respawn the Bridge. You no longer need complex batch file loops for basic stability.

### macOS
The Bridge is now much safer to run as a LaunchAgent. It will no longer "zombie" (fail to restart) when the user clicks **Restart** in the UI, because the Manager process ensures a hard-kill and fresh-respawn of the worker, clearing any hanging long-polling connections.

---

## 3. Real-Time Sync (Chrome Extension)

To ensure the Library UI is always up to date with files saved via the Telegram Bot or other background tasks:
- The Extension polls the Bridge every **15 seconds**.
- Each poll refreshes the local document list and re-renders the UI.
- If you save a file via the Bot, it will automatically appear in your Honoka Library within 15 seconds without requiring a manual page reload.
