# Honoka Bridge Refactor & Integration Plan (2026-04-29)

## Background
The current `honoka-lite/honoka-bridge/index.js` has grown into a massive monolith, currently sitting at **2780 lines** and over **107 KB** in size. It currently handles everything from the HTTP server, file system operations, Telegram bot integration, yt-dlp execution, to Markdown rendering. 

## Current State Analysis
目前的 `index.js` 確實已經太過複雜（Monolith）。
如果繼續將 Notion、GitHub、Jira、Confluence 的推播（Push）功能以及對應 API 邏輯全部塞進同一個檔案中，將會導致：
1. **難以維護與除錯**：像最近發生的 Clipper 影片無法顯示 / 下載失敗的 Bug，在近 3000 行的檔案中追蹤非同步處理的錯誤變得非常困難。
2. **耦合度過高**：不同平台（如 Jira 和 Notion）的 API 邏輯會與檔案系統邏輯混雜，導致牽一髮動全身。

因此，**強烈建議在加入這些新功能之前，先進行架構重構（Refactoring）**。

---

## Proposed Solution (Refactoring Architecture)

我們將把 `honoka-bridge/index.js` 拆分成標準的 Node.js 模組化結構：

```text
honoka-bridge/
├── package.json
├── src/
│   ├── server.js          # HTTP 伺服器啟動與 Cluster 管理
│   ├── routes/            # 處理各種 API 路由
│   │   ├── docs.js        # 處理文件讀寫、列表 (handleSave, handleList)
│   │   ├── templates.js   # 處理模板
│   │   ├── video.js       # 處理 yt-dlp 影片下載
│   │   └── push.js        # [新增] 處理推播至 Notion/Jira/GitHub 等平台
│   ├── services/          # 核心業務邏輯
│   │   ├── filesystem.js  # 處理資料夾建立、Markdown 寫入
│   │   ├── markdown.js    # HTML 轉 Markdown (Turndown)
│   │   └── ytdlp.js       # yt-dlp 執行與錯誤處理 (將在此修復 Video Bug)
│   ├── integrations/      # [新增] 第三方平台串接
│   │   ├── notion.js      
│   │   ├── github.js      
│   │   ├── jira.js        
│   │   └── confluence.js  
│   └── config.js          # 設定檔讀取與環境變數管理
```

## Implementation Phases

### Phase 1: Modularization (重構)
1. 建立 `src/` 目錄，將 `index.js` 的龐大功能按上述結構拆分。
2. 確保現有的 Extension Clipper (儲存文字、擷取圖片) 依然能正常呼叫拆分後的 API。

### Phase 2: Fix Video Clipper Bug (修復影片 Bug)
1. **問題排查**：目前 `index.js` 中的 `yt-dlp` 執行邏輯可能在面對特定網站或超時（Timeout）時發生靜默錯誤（Silent Failure）。
2. **修復**：在獨立的 `services/ytdlp.js` 中強化錯誤捕獲（Error Handling），並確保正確回傳進度或錯誤訊息給 Chrome Extension，讓前端 UI 能正確顯示「下載失敗」或「處理中」。

### Phase 3: Push Integration (實作推播留言功能)
1. **API 設計**：新增一個 HTTP Endpoint `POST /api/push`。
2. **Platform Adapters**：
   - **Notion**: 將 Markdown 轉換為 Notion Blocks 並建立 Page / Comment。
   - **Jira / Confluence**: 使用 Jira API 建立 Issue 或新增 Comment 討論。
   - **GitHub**: 使用 GitHub API 建立 Issue 或 Discussion。
3. **Chrome Extension UI**：在 Clipper 的 Popup 介面中新增一個區塊，讓使用者選擇要將擷取下來的內容同步推播到哪個平台。

---

## Open Questions for Later
1. **第三方平台的驗證方式**：對於 Github, Jira, Confluence，您希望透過環境變數（`.env`）設定 API Token，還是希望在 Extension UI 裡面設定？
2. **Notion 的推播行為**：您希望是將擷取下來的內容新增為 Notion Database 中的一筆新資料（Page），還是在既有的 Page 底下新增留言（Comment）？
