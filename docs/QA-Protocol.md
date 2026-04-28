# Honoka Lite QA Protocol & Technical Requirements

To ensure the stability of the Honoka Lite ecosystem, especially with the Telegram Bot and Bridge components, the following environment requirements and validation steps must be followed.

## 1. Node.js Environment Requirements

### Supported Versions
- **Minimum**: Node.js `v18.19.0`
- **Recommended**: Node.js `v20.x` or `v22.x` (LTS)

### Why Node.js 18.19.0+?
Modern dependencies (like `jsdom` and its sub-modules) have migrated to **Pure ESM**. While Honoka Bridge uses CommonJS (`require`), it relies on the `await import()` syntax to load these ESM modules. 
- Using a version older than 18.19.0 will cause the Bridge to fail when trying to parse webpages.
- **Action**: Always verify your node version with `node -v` before installation.

---

## 2. Dependency Management

### Strict `npm install`
Always run `npm install` inside the `honoka-bridge` directory. 
- If you see `require() of ES Module ... not supported`, it means either your Node version is too old or a dependency has updated to an incompatible version.
- **QA Step**: The `index.js` now uses "Lazy Loading." Check the logs for `Telegram: bot started ✓`. If this log is missing, check the `stderr.log` for dependency errors.

---

## 3. Network & Connectivity (Telegram)

### IPv4 Priority
Due to inconsistent IPv6 routing on many Linux distributions, the Bridge is hard-coded to prioritize IPv4.
- **Setting**: `dns.setDefaultResultOrder('ipv4first')`
- **Validation**: If the bot is not responding, check the logs for `EFATAL` or `ETIMEDOUT`. If you see an IPv6 address (containing colons), the IPv4-first priority has failed or been overridden.

---

## 4. Stability Validation (The "Shield" Protocol)

Whenever moving Honoka to a new Linux system, verify the following:

1. **Manager Check**: Run `ps aux | grep honoka-bridge`. You should see TWO processes (one Manager, one Worker).
2. **Auto-Restart Test**: Manually kill the Worker process (`kill <Worker_PID>`). The Manager should respawn it within 2 seconds.
3. **systemd Status**: Run `systemctl --user status honoka-bridge`. It should be `active (running)`. If it is `failed`, check `journalctl` for "Start request repeated too quickly" and reset with `systemctl --user restart honoka-bridge`.

---

## 5. UI & Sync Consistency

- **Polling Interval**: 15 seconds.
- **Validation**: After saving a file via the Telegram Bot, wait 20 seconds. The file MUST appear in the "Local Docs" table without refreshing the browser.
