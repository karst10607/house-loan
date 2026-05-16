# Honoka Bridge 模組拆分 + Anytype MCP 整合計畫

## 0. 前置：修正已知 Bug

在拆分前先修一個現有 bug，避免搬到新模組時帶過去：

- **`os is not defined`**：`performCapture` 第 499-500 行用了 `os.tmpdir()`，但 `os` 從未被 `require()` 為頂層變數。修正：在 `index.js` 頂部加 `const os = require("os");`
- **Duplicate polling_error handler**：`initTelegramBot` 裡註冊了兩次 `bot.on("polling_error", ...)`（第 2624 行和第 2858 行）。合併為一個。

---

## 1. 拆分策略

**原則**：只移動程式碼、不改邏輯。拆分後每一塊都可以獨立測試，加新功能時只改相關模組。

### 目標目錄結構

```
honoka-bridge/
  index.js                 ← 瘦身：cluster + HTTP server + router
  services/
    telegram.js            ← initTelegramBot + loadDeps
    saver.js               ← saveToDisk + resolveFolder + 相關 helper
    capture.js             ← performCapture + ensurePlaywright
    anytype.js             ← 新增：Anytype MCP 整合
  site-rules.js            ← SITE_RULES (純資料，無依賴)
  settings.js              ← getEffectiveSettings + readSettings + writeSettings
```

---

## 2. 各模組拆分明細

### 2.1 `settings.js`

**搬出內容**：
- `SETTINGS_FILE` 常數
- `readSettings()`
- `writeSettings()`
- `getEffectiveSettings()`

**依賴**：`fs`, `path`, `os` (homedir)

**匯出**：
```js
module.exports = { getEffectiveSettings, readSettings, writeSettings, SETTINGS_FILE };
```

**風險**：極低。純函數，無副作用，無跨模組耦合。

---

### 2.2 `site-rules.js`

**搬出內容**：
- `SITE_RULES` 物件（第 31-77 行）

**依賴**：無

**匯出**：
```js
module.exports = SITE_RULES;
```

**風險**：零。純資料定義。

---

### 2.3 `saver.js`

**搬出內容**：
- `INBOX_DIR`, `DOCS_DIR` 常數定義
- `readRegistry()`, `writeRegistry()`, `readBody()`（如果有被外部用到）
- `resolveFolder()`
- `sanitizeFolderName()`
- `downloadImage()`
- `saveToDisk()`（第 278-397 行）

**依賴**：
- `fs`, `path`, `https`, `http`（下載圖片用）
- `site-rules.js`（SITE_RULES）
- `jsdom`（延遲載入，在 saveToDisk 內部 require）

**匯出**：
```js
module.exports = {
  saveToDisk,
  INBOX_DIR,
  DOCS_DIR,
  readRegistry,
  writeRegistry,
  resolveFolder,
  sanitizeFolderName,
};
```

**注意**：`saveToDisk` 內的 SITE_RULES 引用改為 `require("./site-rules")`。

---

### 2.4 `capture.js`

**搬出內容**：
- `ensurePlaywright()`（第 411-429 行）
- `performCapture()`（第 431-512 行）

**依賴**：`path`, `os`, `playwright`（延遲載入）

**匯出**：
```js
module.exports = { performCapture, ensurePlaywright };
```

**修正**：加 `const os = require("os");` 到此模組頂部。

---

### 2.5 `services/telegram.js`

**搬出內容**：
- `initTelegramBot()` 整個函數（第 2564-2861 行）
- `_telegramBot` 變數
- `loadDeps()` 從 initTelegramBot 內部提升為模組級別

**依賴**：
- `node-telegram-bot-api`（延遲載入）
- `axios`, `jsdom`, `@mozilla/readability`, `turndown`（延遲載入 via loadDeps）
- `../settings.js` → `getEffectiveSettings()`
- `../saver.js` → `saveToDisk()`, `INBOX_DIR`
- `../capture.js` → `performCapture()`
- `path`, `fs`
- `downloadUniversalVideo`（需從 index.js 傳入或另拆）

**匯出**：
```js
module.exports = { initTelegramBot, getTelegramBot: () => _telegramBot };
```

**關鍵決策**：`downloadUniversalVideo` 目前也定義在 index.js。兩個選項：
- **A) 一併拆到 `services/video.js`**：乾淨但多一個檔案
- **B) 透過參數注入**：initTelegramBot 接受 `{ downloadUniversalVideo }` 參數

**建議採用 A**，因為 video 下載邏輯也是獨立功能，未來也會擴展。

---

### 2.6 `services/video.js`（額外拆分）

**搬出內容**：
- `downloadUniversalVideo()` 函數
- yt-dlp 相關邏輯
- 視頻儲存目錄常數

**依賴**：`child_process`, `path`, `fs`

**匯出**：
```js
module.exports = { downloadUniversalVideo };
```

---

## 3. 拆分後的 `index.js` 骨架

```js
#!/usr/bin/env node

const cluster = require('cluster');

if (cluster.isPrimary || cluster.isMaster) {
  // ... cluster manager 不動 ...
  return;
}

// --- Worker ---
require('dns').setDefaultResultOrder('ipv4first');

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");  // 修正 bug

// 拆出的模組
const { getEffectiveSettings, readSettings, writeSettings } = require("./settings");
const { saveToDisk, INBOX_DIR, DOCS_DIR, readRegistry, writeRegistry } = require("./saver");
const { performCapture } = require("./capture");
const { initTelegramBot } = require("./services/telegram");
const { downloadUniversalVideo } = require("./services/video");

const SITE_RULES = require("./site-rules");

// ... 常數定義 (PORT, EDITOR, etc.) ...
// ... helper 函數 (cors, json, etc.) ...
// ... HTTP handler 函數 (handleSave, handleCapture, etc.) ...
// ... Diff 相關函數不動 ...
// ... 內嵌 HTML 頁面不動 ...

// HTTP server
const server = http.createServer(async (req, res) => {
  // ... 路由表不動，handler 引用已拆到頂層的 require ...
});

server.listen(PORT, "0.0.0.0", () => { /* ... */ });

// 啟動 Telegram Bot
initTelegramBot();
```

---

## 4. 新功能：Anytype MCP 整合

### 4.1 功能描述

當 Telegram Bot 收到一篇文章並成功解析後，除了存到本地 Markdown，同時透過 Anytype MCP API 將文章存到對應的 Anytype Collection。

### 4.2 流程設計

```
Telegram 收到 URL
  ↓
解析文章 (Readability + Turndown)
  ↓
saveToDisk() → 本地 Markdown  ← 現有流程不變
  ↓
classifyArticle() → 判斷分類   ← 新增
  ↓
saveToAnytype() → Anytype MCP   ← 新增
  ↓
回報結果給 Telegram
```

### 4.3 `services/anytype.js` 設計

```js
// services/anytype.js

/**
 * 將文章存到 Anytype 指定的 Collection
 *
 * @param {Object} params
 * @param {string} params.title    - 文章標題
 * @param {string} params.markdown - Markdown 內容
 * @param {string} params.url      - 原始 URL
 * @param {string} params.category - 分類 (real-estate, article, video, etc.)
 * @param {Object} params.properties - 額外屬性 (price, ping, floor, layout...)
 * @returns {Promise<{ok: boolean, objectId?: string, error?: string}>}
 */
async function saveToAnytype({ title, markdown, url, category, properties }) {
  const settings = getEffectiveSettings();

  // 如果沒有設定 Anytype，靜默跳過（不影響現有流程）
  if (!settings.anytypeSpaceId || !settings.anytypeApiUrl) {
    return { ok: false, error: "Anytype not configured" };
  }

  // 1. 根據 category 決定目標 Collection
  const collectionId = resolveCollection(category, settings);

  // 2. 透過 Anytype MCP API 建立 Object
  //    POST {anytypeApiUrl}/spaces/{spaceId}/objects
  //    Body: { name, type, collectionId, properties, content (markdown) }

  try {
    const resp = await axios.post(
      `${settings.anytypeApiUrl}/spaces/${settings.anytypeSpaceId}/objects`,
      {
        name: title,
        type: "note",  // 或根據 category 對應
        collectionId,
        properties: mapProperties(properties, category),
        content: markdown,
      },
      {
        headers: { "Authorization": `Bearer ${settings.anytypeApiKey}` },
        timeout: 10000,
      }
    );
    return { ok: true, objectId: resp.data.id };
  } catch (err) {
    console.error("[Anytype] Save failed:", err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 根據文章分類對應到 Anytype Collection ID
 * 設定格式：settings.anytypeCollections = { "real-estate": "id1", "article": "id2", ... }
 */
function resolveCollection(category, settings) {
  const collections = settings.anytypeCollections || {};
  return collections[category] || collections["default"] || null;
}

/**
 * 將 Honoka properties 對應到 Anytype Object 的屬性格式
 */
function mapProperties(properties, category) {
  const mapped = {};
  if (properties.price) mapped.price = properties.price;
  if (properties.ping) mapped.area = properties.ping;
  if (properties.floor) mapped.floor = properties.floor;
  if (properties.layout) mapped.layout = properties.layout;
  if (properties.community) mapped.community = properties.community;
  return mapped;
}
```

### 4.4 Settings 擴充

在 `settings.js` 的 `getEffectiveSettings()` 增加環境變數支援：

```js
function getEffectiveSettings() {
  const stored = readSettings();
  return {
    ...stored,
    telegramBotToken:     process.env.TELEGRAM_BOT_TOKEN     || stored.telegramBotToken     || "",
    telegramAllowedUser:  process.env.TELEGRAM_ALLOWED_USER   || stored.telegramAllowedUser  || "",
    slackBotToken:        process.env.SLACK_BOT_TOKEN         || stored.slackBotToken        || "",
    slackAllowedChannel:  process.env.SLACK_ALLOWED_CHANNEL   || stored.slackAllowedChannel  || "",
    // --- 新增 ---
    anytypeApiUrl:        process.env.ANYTYPE_API_URL          || stored.anytypeApiUrl        || "",
    anytypeSpaceId:       process.env.ANYTYPE_SPACE_ID        || stored.anytypeSpaceId       || "",
    anytypeApiKey:        process.env.ANYTYPE_API_KEY         || stored.anytypeApiKey        || "",
    anytypeCollections:   stored.anytypeCollections           || {},
  };
}
```

Settings UI 也需要加入對應欄位（但這是後續步驟）。

### 4.5 整合到 Telegram handler

在 `services/telegram.js` 的訊息處理流程中，`saveToDisk()` 成功後插入：

```js
// 現有：const result = await saveToDisk({ ... });

// 新增：同步到 Anytype
const anytypeResult = await saveToAnytype({
  title: article.title || rawUrl,
  markdown,
  url: rawUrl,
  category: "real-estate",  // 或根據 URL 分類
  properties: result.properties || {},
});

let anytypeStatus = "";
if (anytypeResult.ok) {
  anytypeStatus = "\nAnytype: Synced ✓";
} else if (anytypeResult.error !== "Anytype not configured") {
  anytypeStatus = "\nAnytype: Failed (" + anytypeResult.error + ")";
}

// 加到回傳給使用者的訊息中
```

**關鍵設計**：Anytype 同步是 best-effort，失敗不影響本地存檔流程。

---

## 5. 執行順序

| 步驟 | 內容 | 影響範圍 | 預計改動量 |
|------|------|---------|-----------|
| **0** | 修正 `os` bug + 合併 polling_error handler | index.js 2 處 | ~5 行 |
| **1** | 建立 `settings.js`，搬出 4 個函數 | index.js → settings.js | ~40 行搬移 |
| **2** | 建立 `site-rules.js`，搬出 SITE_RULES | index.js → site-rules.js | ~50 行搬移 |
| **3** | 建立 `saver.js`，搬出 saveToDisk + 相關 helper | index.js → saver.js | ~150 行搬移 |
| **4** | 建立 `capture.js`，搬出 performCapture + ensurePlaywright | index.js → capture.js | ~110 行搬移 |
| **5** | 建立 `services/video.js`，搬出 downloadUniversalVideo | index.js → services/video.js | ~100 行搬移 |
| **6** | 建立 `services/telegram.js`，搬出 initTelegramBot | index.js → services/telegram.js | ~300 行搬移 |
| **7** | 更新 index.js 的 require + 移除已搬出程式碼 | index.js | 刪 ~750 行，加 ~10 行 require |
| **8** | 驗證：啟動 server，測試 Telegram bot 收文章 | 全部 | 手動測試 |
| **9** | 建立 `services/anytype.js` | 新檔案 | ~80 行 |
| **10** | 擴充 settings + 整合到 telegram handler | settings.js, telegram.js | ~30 行 |
| **11** | 端對端測試：TG 發 URL → 本地存檔 → Anytype 同步 | 全部 | 手動測試 |

### 驗證檢查點

每完成一個步驟（0-7），都應該：
1. `node index.js` 能正常啟動
2. `curl http://127.0.0.1:44124/status` 回應正常
3. Telegram bot 能收到訊息並處理 URL（步驟 6 之後）

---

## 6. 風險與注意事項

| 風險 | 緩解措施 |
|------|---------|
| 拆分時遺漏跨模組依賴 | 每步拆完立即啟動測試 |
| `require()` 路徑在不同 OS 的行為差異 | 使用 `path.join(__dirname, ...)` |
| Anytype MCP API 尚未確認實際規格 | 先用假接口寫好框架，等 MCP 確認後填入 |
| `downloadUniversalVideo` 被 HTTP handler 和 Telegram 同時引用 | 拆到獨立模組後兩邊 require 同一個 |
| Cluster worker 中的 module cache | CommonJS require 有 cache，不會重複載入，安全 |

---

## 7. 不做的事（範圍外）

- **不重構** Diff engine、Charts、HTML 頁面渲染等其他區域
- **不加**測試框架（可以後續加，但不在本次範圍）
- **不動** Chrome extension 程式碼
- **不升級**到 ESM（維持 CommonJS，避免大規模改動）
- **不改** Settings UI（Anytype 設定暫時透過 env var 或直接編輯 settings.json）

---

## 8. 實際確認的 Anytype API 規格（2025-05 實測）

### 官方資源

| 資源 | 連結 |
|------|------|
| MCP Server | [anyproto/anytype-mcp](https://github.com/anyproto/anytype-mcp) |
| REST API Docs | [developers.anytype.io](https://developers.anytype.io/docs/reference/2025-05-20/create-object/) |
| API Repo | [anyproto/anytype-api](https://github.com/anyproto/anytype-api) |

### 核心端點

| 操作 | Method | Path |
|------|--------|------|
| 建立物件 | POST | `/v1/spaces/:space_id/objects` |
| 加入 Collection | POST | `/v1/spaces/:space_id/lists/:list_id/objects` |
| 列出物件 | GET | `/v1/spaces/:space_id/objects` |
| 搜尋物件 | POST | `/v1/spaces/:space_id/search` |

### 認證

- Header: `Authorization: Bearer <API_KEY>`
- Header: `Anytype-Version: 2025-11-08`
- API Key 從 Anytype 桌面端 Settings 取得
- 預設連線位址: `http://127.0.0.1:31009`

### Create Object Request Body

```json
{
  "name": "文章標題",
  "type": "note",
  "properties": {
    "source": "https://example.com/article",
    "price": "1200萬",
    "area": "35坪"
  },
  "body": "# Markdown content here"
}
```

### Add to Collection Request Body

```json
["object-id-1", "object-id-2"]
```

Path: `/v1/spaces/:space_id/lists/:collection_id/objects`

### 實作決策

- **不走 MCP 協定**：MCP 是給 AI assistant 用的，我們是 Node.js server，直接打 REST API 更簡單高效
- **延遲載入 axios**：只在實際需要呼叫 Anytype 時才 require，避免啟動時依賴問題
- **best-effort 設計**：Anytype 同步失敗不影響本地存檔流程

---

## 9. 執行狀態

| 步驟 | 狀態 |
|------|------|
| 0. 修正 os bug + 合併 polling_error | Done |
| 1. settings.js | Done |
| 2. site-rules.js | Done |
| 3. saver.js | Done |
| 4. capture.js | Done |
| 5. services/video.js | Done |
| 6. services/telegram.js | Done |
| 7. 更新 index.js require | Done |
| 8. 啟動驗證 | Done (server 正常啟動，/status 回應正常) |
| 9. services/anytype.js | Done |
| 10. 擴充 settings + 整合 telegram handler | Done |
| 11. 端對端測試 | Done (2026-05-16: HTTP 201, objectId 驗證成功) |
