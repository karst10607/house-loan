# Honoka Bridge Changelog

## v1.6.0 — 2026-05-16

### Stability: Auto-kill stale port + crash loop protection

- **Auto-kill**: Bridge now detects and kills any stale process holding port 44124 before starting, preventing EADDRINUSE crash on restart.
- **Crash limit**: After 10 rapid crashes, bridge stops retrying instead of looping forever.
- **Backoff**: Restart delay scales from 0.5s → 2.5s, reducing pressure on port binding.
- **CI: Version sync**: Release workflow now auto-syncs version across `manifest.json`, `package.json`, and `index.js` (`BRIDGE_VERSION`) from the git tag.

### Fixes

- Fixed bridge version hard-coded in `index.js` (was reading from `package.json`, now a single constant `BRIDGE_VERSION`).
- Synced Chrome extension version from 1.4.6 → 1.5.4.

---

## v1.5.0 — 2026-05-16

### New Feature: Anytype Integration

Telegram Bot 收到文章後，除了存到本地 Markdown，現在可以同步到 Anytype 的指定 Collection。

**流程**：`TG 收到 URL` → `解析文章` → `saveToDisk (本地)` → `performCapture (截圖)` → `saveToAnytype (雲端)`

### Anytype 設定方式

有兩種方式，擇一即可：

#### 方式一：環境變數（推薦用於開發/部署）

```bash
export ANYTYPE_API_URL="http://127.0.0.1:31009"   # 預設值，通常不用改
export ANYTYPE_API_KEY="你的API_KEY"                # 從 Anytype 桌面端取得
export ANYTYPE_SPACE_ID="你的SPACE_ID"              # 從 Anytype API 或 URL 取得
```

#### 方式二：設定檔

編輯 `~/.honoka-docs/.honoka/settings.json`：

```json
{
  "anytypeApiUrl": "http://127.0.0.1:31009",
  "anytypeApiKey": "你的API_KEY",
  "anytypeSpaceId": "你的SPACE_ID",
  "anytypeCollections": {
    "real-estate": "collection-id-for-real-estate",
    "default": "collection-id-for-other-articles"
  }
}
```

#### 如何取得 API Key

1. 開啟 Anytype 桌面端
2. 進入 Settings → Developers → Generate API Key
3. 複製 API Key 填入上方設定

#### 如何取得 Space ID

- 方法 A：在 Anytype 桌面端開啟某個 Space，URL 中會包含 Space ID
- 方法 B：啟動 Anytype 後呼叫 `GET http://127.0.0.1:31009/v1/spaces`，回傳的列表中每個 space 都有 `id`

#### 如何取得 Collection ID

- 在 Anytype 桌面端開啟目標 Collection，URL 中的 ID 即為 Collection ID
- 或呼叫 `GET http://127.0.0.1:31009/v1/spaces/{space_id}/objects` 搜尋 type 為 collection 的物件

#### 重要注意事項

- **沒有設定 Anytype 時，行為跟 v1.4.6 完全一樣**，不會有任何錯誤或提示
- Anytype 同步是 best-effort：失敗不影響本地存檔
- Telegram Bot 會在回覆訊息中顯示 Anytype 同步狀態（Synced / Failed / 不顯示）
- `anytypeCollections` 中的 key 對應到文章分類（目前 Telegram 存的文章都是 `"real-estate"` 分類）
- 未設定 `anytypeCollections` 時，物件只會建立但不會被加入任何 Collection

---

### Architecture: Module Extraction

將原本 3000+ 行的 `index.js` 拆分為 7 個模組：

```
honoka-bridge/
  index.js              ← HTTP server + router（瘦身後）
  settings.js           ← getEffectiveSettings, readSettings, writeSettings
  site-rules.js         ← SITE_RULES 物件（591、永慶、大家房屋）
  saver.js              ← saveToDisk + 檔案系統相關 helpers
  capture.js            ← performCapture + ensurePlaywright
  services/
    telegram.js         ← initTelegramBot + loadDeps
    video.js            ← downloadUniversalVideo
    anytype.js          ← saveToAnytype（新功能）
```

### Bug Fixes

- **`os is not defined`**：`performCapture` 中使用 `os.tmpdir()` 但 `os` 從未宣告為頂層變數，當 `targetDir` 未傳入時會觸發 ReferenceError
- **Duplicate polling_error handler**：`initTelegramBot` 中註冊了兩次 `bot.on("polling_error")`，第二次無節流邏輯，繞過了 15 秒節流機制
- **yt-dlp 跨平台路徑**：原本硬編碼 Linux 路徑 `/home/koto/miniconda3/bin/yt-dlp`，改為按平台自動解析（Windows: `yt-dlp.exe`, macOS: `/opt/homebrew/bin/yt-dlp`, Linux: 原路徑）

### Settings 新增欄位

| 欄位 | 環境變數 | 說明 |
|------|---------|------|
| `anytypeApiUrl` | `ANYTYPE_API_URL` | Anytype REST API 位址（預設 `http://127.0.0.1:31009`）|
| `anytypeApiKey` | `ANYTYPE_API_KEY` | API 認證金鑰 |
| `anytypeSpaceId` | `ANYTYPE_SPACE_ID` | 目標 Space ID |
| `anytypeCollections` | — | 分類→Collection ID 對應表 |

---

## v1.4.6 — Previous Release

- Initial monolithic version
