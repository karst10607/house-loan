# 去中心化 P2P 知識庫與協作平台 (Roadmap)

探討將「本機計算與儲存專案」全面升格為「跨平台 P2P 知識協作網絡」，並旨在徹底打破 Notion, Jira, Slack 等 SaaS 平台的 Vendor Lock-in (平台綁架) 限制。

---

## 🌟 核心架構願景：雙引擎驅動 (Native Bridge Architecture)
本專案正式升級為「背景引擎 + 瀏覽器擴充」的雙機體系。這是唯一能同時兼顧「底層硬碟網路權限」與「無縫融入日常工作介面」的終極解法：
- **核心後端 (Electron Background Agent)**：作為安靜常駐的心臟 (Muscle)，負責維運 `Hyperdrive`（本機實體檔案系統/知識圖床）、`Hyperbee`（鍵值/留言資料庫）與 `Hyperswarm`（無中央伺服器的網路打洞連線）。
- **前端介面 (Chrome Extension frontend)**：作為使用者的眼睛與觸手，負責將「P2P 討論牆」無縫注入使用者的分頁，並向 Electron 下達讀寫指令。

---

## 🔑 核心功能目標

### 1. 彈性與跨平台自主認證 (Multi-Platform Identity)
- 完全拋棄傳統自建的帳號密碼註冊機制。
- **Session 借用機制**：Extension 根據使用者目前活躍的網頁（如 GitHub, Slack, Workspace），自動借用並驗證既有的登入狀態。使用者可以自由選擇用哪種「身分」進行 P2P 留言。
- 認證結果將轉為數位簽章附著於 P2P 訊息中，確保不需架設中央伺服器，仍可信任留言者的公司或社群身份。

### 2. 訂閱制資訊動態流 (P2P Follow / Subscription Model)
- 提供如同 Twitter(X) 或 RSS 般的強大去中心化訂閱機制：
- **動態訂閱 (Follow Users)**：直接追蹤某位同事或專家的 P2P Public Key。Electron 在背景會自動為您拉取該對象最新的動作（於 GitHub 的發布、在 Notion 的新註解等）。
- **專題訂閱 (Follow Repos/Topics)**：追蹤特定的專案/知識庫，任何人在上面發布的 P2P 變更，皆能即時推送至您的全局時間軸 (Activity Wall)。

### 3. P2P 知識圖床與去中心留言牆 (Decentralized Markdown & Social Wall)
- **知識圖床 (Hyperdrive)**：所有的 Markdown 筆記、架構截圖，全數保留在本機並透過去中心化網路 `hyper://` 提供即時串流渲染。不假手 AWS。
- **留言社群化 (Autobase Wall)**：在任意平台的網頁側邊注入留言區塊，發言直接寫入 `Hyperbee`。並利用 `Autobase` 融合訂閱者的日誌，將原本分散在不同工具的討論流完美整合回一條時間軸。

---

## 📍 分階段實作計畫 (Milestones)

- [x] **Phase 0：P2P 底層引擎就緒**
  (已達成) 脫離 Pear 沙盒平台，透過 `v1.9.0` 穩固掛載於標準 Electron 上，並實現 P2P 的穩定狀態同步、打洞傳輸與反應式 UI (Reactive UI) 更新。

- [ ] **Phase 1：建構橋接器 (Extension-Electron Bridge)**
  進入雙機開發階段。撰寫 Chrome Extension 骨架，建立 Extension 與背景 Electron App 之間的通訊通道 (如 Local HTTP server 或 Native Messaging API)，讓擴充可以讀寫 P2P 狀態。

- [ ] **Phase 2：身分捕獲與 P2P 簡單留言牆 (Identity & Simple Hyperbee)**
  實作 Extension 讀取 GitHub/Slack 登入身份的邏輯。並在 Electron 端打通 `Hyperbee` 寫入機制，讓使用者能在擴充介面上留下第一筆帶有身份認證的 P2P 留言。

- [ ] **Phase 3：訂閱流與動態渲染 (Subscription & Activity Feeds)**
  完成 P2P Public Key 的互相追蹤機制 (Follow)。並能在 Extension 介面上動態呈現「訂閱對象」最新推送來的 Markdown 或訊息流，真正擺脫舊版「每次改動都需要重新打包發布 App」的限制。

- [ ] **Phase 4：知識總和與全局搜尋 (Causal Merge & Full-Text Search)**
  利用 `Autobase` 處理極端情況下多人同時留言的網路邏輯時序。並在本地端引入全文搜尋引擎 (`MiniSearch` 等)，能一句話跨海撈取所有已訂閱節點的文字記錄與圖床檔案，消滅資訊孤島。
