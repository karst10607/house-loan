# Notion 作為 Headless CMS 架設論壇架構探討

本文檔總結了利用 Notion 作為後端資料庫（Headless CMS），為現有 P2P/Web 應用提供論壇功能的實作方向探討。

## 背景說明

目前專案中包含一個純靜態的 `forum.html` 頁面。為了實現動態資料儲存、發文、留言功能，同時免去維護傳統資料庫（如 MySQL/PostgreSQL）的負擔，我們考慮將 Notion 作為資料存儲與管理的後台。

## 關鍵限制：為什麼不能用純前端 (forum.html) 直連 Notion？

1. **安全性（Token 洩漏）：** Notion API 需要一把 Secret Token (如 `ntn_...`)，如果寫在前端的 JavaScript 裡，任何人都可以輕易取得 Token，進而竄改或刪除所有的 Notion 資料。
2. **CORS 限制：** Notion 官方為了安全性，嚴格禁止瀏覽器直接發送跨網域請求 (CORS) 到他們的 API 端點。

因此，**前端的實作必須搭配一個「後端」或「中介層 (Proxy)」** 來安全地跟 Notion API 溝通。

## 實作方向比較

### 選擇 1：Next.js (最推薦、業界標準)
目前主流將 Notion 當作 CMS 的現代網站，多數採用 Next.js (React) 開發。
* **做法：** 利用 Next.js 內建的 `API Routes`（伺服器端功能）。前端 React 元件呼叫 Next.js API，Next.js API 帶著 Token 在伺服器端呼叫 Notion API，再把過濾後的乾淨資料傳回給前端。
* **優點：** 效能極佳、SEO 良好，Vercel 部署極簡。可搭配 `react-notion-x` 快速渲染 Notion Block。
* **適用情境：** 打算架設公開在網路上的標準論壇網站，且希望未來擴展性強。

### 選擇 2：維持 `forum.html` + Serverless 中介層
保留目前的純 HTML/JS 專案，透過無伺服器架構建立 API Proxy。
* **做法：** 使用 Cloudflare Workers 或 Vercel Functions 撰寫一小段中介程式。`forum.html` 呼叫 Worker 網址，Worker 負責夾帶 Token 去跟 Notion 拿資料並回傳。
* **優點：** 幾乎不用重寫目前辛苦刻好的 HTML 和 CSS 樣式。
* **適用情境：** 不想學 React，想保持專案最輕量級的狀態。

### 選擇 3：結合桌面端 P2P 應用 (Pear / Electron)
針對目前的 P2P / 桌面應用開發架構。
* **做法：** 在 Pear 或 Electron 的主處理程序 (Node.js 後端) 引入 `@notionhq/client`。由於 Node.js 沒有 CORS 限制且 Token 不對外公開，後端抓取資料後，透過 IPC 或 Local Server 傳遞給前端的 `forum.html`。
* **優點：** 完美融入現有桌面端架構，無需租用或依賴外部雲端伺服器 (除了 Notion API 本身)。
* **適用情境：** 論壇功能是內建於 P2P 桌面軟體中的一個模組。

## 決策

基於功能完整性與未來發展考量，決定優先採用 **選擇 1 (Next.js)** 進行實作。

---

## 補充探討與實驗紀錄 (已暫存)

> **註記**：雖然目前專案已經決定這個方向，但由於後續主軸將會改變，這部分的探討與實作實驗將暫時打包封存，留待未來進一步研究。以下記錄此架構的重要特性。

### 為什麼選擇 Notion 當 CMS？
在評估「選擇 1 (Next.js + Notion)」時，我們觀察到（例如 Nobelium, react-notion-x, Super.so 等）業界做法，主要看中以下優勢：
1. **極致的編輯體驗 (零學習成本)**：團隊成員可直接使用 Notion 的豐富編輯器排版，不需學習 markdown 或登入傳統後台。
2. **免除後端與資料庫維護的痛苦**：不需架設 MySQL/PostgreSQL，Notion 本身即是強大的雲端資料庫。
3. **內建豐富的欄位與狀態管理**：透過 Notion Database 的屬性 (Tags, Status, Date)，前端能輕易過濾與抓取特定狀態的資料。
4. **效能與 SEO 極佳**：搭配 Next.js 的 ISR (靜態增量生成)，可在伺服器端預先抓取 Notion 資料並編譯成純 HTML，達到極快的載入速度與完美的搜尋引擎最佳化。

### 如何在此架構下實現 RSS 訂閱？
觀察如 Nobelium 等開源專案，其 RSS 實現原理非常單純：
1. **抓取資料**：Next.js 透過 Notion API 抓取所有 `Status = Published` 的文章清單（包含標題、日期、摘要、Slug）。
2. **轉換格式**：在 Next.js 的伺服器端（如編譯時期或 API 路由），利用 Node.js 套件（如 `feed`），將抓回來的 JSON 資料轉換成標準的 RSS XML結構。
3. **輸出檔案**：將產生的 XML 靜態寫入到 `/public/feed.xml`，或是建立動態路由 `/api/rss` 供閱讀器直接訂閱。
這完美體現了「後端與內容交給 Notion，輸出格式與渲染交給 Next.js 隨意發揮」的強大彈性。

Source = https://nobelium.vercel.app/search

