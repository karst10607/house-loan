# CHANGELOG

## v1.7.1 (2026-04-12)

### 🐛 Bug Fixes & 踩坑筆記
- **(坑) 視窗 Title Bar 無法結束程式 (Pear App Shutdown API)**
  - **問題**：原先假設 `ui.app.parent.close()` 存在，但 `pear-electron` 的底層 API 中，`parent` 不具有關閉整個 App 執行緒的方法，或是 `ui.app.close()` 只會關掉目前畫面 (View)，背景核心行程仍駐留。
  - **解法**：全面改呼叫 `ui.app.quit()`，該指令會直接觸發底層 Pear Runtime 關閉整個視窗並向作業系統完整結束程式 (包含核心 IPC Socket)。
- **(坑) 動態網址傳遞變數被吞掉 (ipcPort 遺失)**
  - **問題**：在原本設計的通訊機制中，本來預期待 `main.js` 動態指派 Port 號後，透過 `runtime.start({ openOptions: { entry: '/index.html?ipcPort=12345' } })` 把 port 帶給前端。但 Pear-Electron 底層設計可能在某些狀態下忽略/攔截了 Query Parameters，導致前端 `app.js` 取到的 URL Search 永遠為空，引發 `Cannot find IPC port from URL` 錯誤。
  - **解法**：善用 **Hypercore 原生的單一實例硬鎖定 (File Lock) 機制**。因為同一台主機不可能同時開啟兩份使用同一個 Corestore 目錄的 Pear App (Hypercore 會拒絕存取)，代表連線的衝突率極低，故直接將 `main.js` 與 `app.js` 的 HTTP 內部通訊埠綁定寫死為 `44123`，免除任何環境變數與參數傳遞的不穩定性。
## v1.7.0 (2026-04-12)

### 🚀 Features
- **Hyperswarm 雙機連線同步**：
  - 左下角會自動顯示「本機 P2P Key」。
  - 在「輸入遠端 Key」欄位貼上別台電腦的 Key，即可在左側生成「🔗 遠端資料夾」。
  - 自動掃描遠端 Host 發布的檔案清單，本機可直接預覽 PDF 及照片。
  - 右下角新增連線狀態與 Peer 數量顯示 (例如：`v1.7.0 · 1 peer`)。

### ⚠️ [核心架構踩坑筆記：未來開新專案必看]
1. **P2P 邏輯 (Corestore/Hyperdrive/Hyperswarm) 必須跑在 `main.js` (Bare Runtime)**
   - **坑點**：原本想簡化架構，將 P2P 套件直接引入 `app.js` (Chromium Renderer Process)。結果導致 `Loading...` 永不結束且毫無報錯。
   - **原因**：Chromium Sandbox 預設拉起 ES Module 解析時無法正確載入 C++ Node 原生模組 (`sodium-native` 等)。原生功能只能在負責系統層的 Bare runtime 穩定運作。
   - **解法**：檔案讀寫與 P2P 網路嚴格切分回 `main.js`，透過 IPC 只傳送 JSON/Base64 給前端 `app.js` 繪圖。
2. **`Pear.messages` 已經棄用並失效**
   - **坑點**：舊版的 `Pear.messages((msg) => {})` 在 renderer 被呼叫時收不到 `main.js` 的訊息（導致 Promise 永遠 pending），且終端機會噴警告 `[ DEPRECATED ] Pear.messages is deprecated`。
   - **解法**：必須使用新的 `pear-message` 與 `pear-messages` NPM 套件來實作跨進程 Pub/Sub IPC。
     - **Main 端**：`import messages from 'pear-messages'; import message from 'pear-message';` 使用 `messages({target: 'main'})` 收聽，用 `message({target: 'renderer'})` 寄出。
     - **Renderer 端**：規則同上，交換 Target 即可。

---## v1.5.0 (2026-04-12)

### ✨ New Features
- **Hyperdrive 檔案存取**：整合 `hyperdrive` + `corestore` 實作本機 P2P 檔案儲存。上傳的 PDF 與圖片會寫入本機 Hyperdrive，不再使用 IndexedDB。
- **真實檔案上傳**：中間欄文件列表新增上傳按鈕，支援 PDF、圖片多檔上傳。
- **即時 Blob 預覽**：點擊已上傳的文件時，會從 Hyperdrive 讀取二進位資料轉換為 `ObjectURL` 在右側即時預覽。
- **P2P Key 介面**：左下角新增「本機 Public Key」顯示與「遠端 Key 輸入」區塊，為未來雙機連線做準備。
- **自訂 Title Bar**：因 Pear Runtime 強制隱藏原生視窗邊框，新增 HTML/CSS 手刻的自訂標題列，含最小化、最大化、關閉按鈕，跨平台 (Windows / macOS / Linux) 通用。

### 🐛 Bug Fixes
- **[CRITICAL] 修正 pear-bridge URL Setter 崩潰**  
  `pear-bridge@1.2.5` 的 `index.js:53` 直接執行 `req.url = ...`，但底層 `bare-http1` 已將 `HTTPIncomingMessage.url` 改為唯讀 getter，導致整個 HTTP Bridge 啟動失敗、應用程式全黑。  
  **修復方式**：將 `req.url = mappedUrl` 改為 `{ __proto__: req, url: mappedUrl }` 包裝物件，與 pear-bridge 自身在其他行（190、198、204）使用的相同手法一致。  
  > ⚠️ 此修正直接 patch 於 `node_modules/pear-bridge/index.js`，若執行 `npm install` 會被覆蓋。需等待上游發佈修復版本。

### 🎨 UI Improvements  
- **三欄版面修正**：左欄 (220px) 與中欄 (280px) 設定 `flex-shrink: 0` + `min-width`，修復先前兩欄擠壓折疊的問題。
- **視窗放大修正**：Window Control 按鈕現透過 `ui.app.parent` 操作父視窗（而非 View 本身），修復最大化無效的問題。
- **深色主題優化**：移除過度的 Glassmorphism 模糊效果，改用更純粹的深色配色方案，降低 GPU 壓力且更接近 Evernote 風格。

### 📦 Dependencies
- 新增：`hyperdrive`, `hyperbee`, `corestore`, `b4a`

---

## v1.4.0 (2026-04-12)

### ✨ New Features
- 初版三欄式 Evernote 風格 GUI（假資料）
- 自訂 Title Bar 初版
