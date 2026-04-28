# Honoka 與 Notion 論壇整合架構與可行性分析

自從探討將「Honoka (Chrome Extension + Bridge)」引入論壇架構後，我們的目標演變為：**如何在保護管理者 Notion Token 不外洩的前提下，讓一般使用者也能無縫參與論壇？**

本文件詳細記錄了我們討論過的架構演進，並深入分析「伺服器代理」與「P2P 轉接」兩種方案的可行性與技術細節。

---

## 1. 核心挑戰回顧

*   **Token 安全性**：Notion Integration Token 擁有極高權限，絕對不能硬編碼 (Hardcode) 放在 Chrome Extension 或純前端程式碼中。
*   **通知與即時性**：Notion 原生的通知僅限 Workspace 成員。若要讓論壇參與者收到回覆通知，必須仰賴外部機制（如 Webhook 或本地 Bridge 輪詢）。
*   **圖片與檔案儲存**：Notion 的圖片網址有時效性。若要轉向本地優先 (Local-first) 或 P2P，必須由 Bridge 將圖片下載到本地快取。

---

## 2. 方案一：伺服器代理模式 (Server Proxy)

這是傳統且最穩定的 Web 架構，也是我們目前 Next.js 專案的基礎。

### 運作原理
1.  **管理節點 (你的伺服器)**：運行 Next.js 應用程式，並在後端 `.env` 中安全地保管 `NOTION_TOKEN`。
2.  **使用者端 (Honoka Extension)**：Extension 作為一個純粹的前端「顯示器 (Viewer)」。當使用者打開論壇時，其實是向你的 Next.js 伺服器請求畫面或 API。
3.  **讀寫流程**：使用者發送留言 $\rightarrow$ Next.js 伺服器接收 $\rightarrow$ 伺服器使用 Token 寫入 Notion $\rightarrow$ 伺服器回傳成功訊息。

### 可行性評估：極高
*   **優點**：技術成熟、實作最快。使用者不需要理解複雜的 P2P 概念，只要裝 Extension 就能用。安全性 100% 由伺服器把關。
*   **缺點**：你必須託管一個伺服器（例如放上 Vercel，或是用 ngrok 將本地 Port 對外開放）。如果伺服器斷線，論壇就停擺。

---

## 3. 方案二：P2P 中繼與 Notion 混合模式 (P2P Relay)

這正是你所好奇的核心架構：**使用者沒有 Token，要怎麼透過 Bridge 將留言寫回你的 Notion？P2P 在這裡到底扮演什麼角色？**

### 運作原理 (詳細拆解)

在這個架構中，P2P **不只是**用來 Relay 傳輸訊號，它其實也參與了**分散式保存**。你的 `honoka-bridge` 將扮演「超級節點 (Master Node)」。

#### A. 讀取論壇 (Data Distribution)
1.  **資料下行**：你的 Master Bridge 使用 Token 抓取 Notion 資料與圖片，並寫入一個 **P2P 公共頻道 (Hyperbee/Hyperdrive)**。
2.  **使用者同步**：其他使用者的 Bridge 訂閱了這個頻道，他們透過 P2P 網路從你的電腦把論壇資料同步到他們自己的硬碟裡。
3.  **前端顯示**：使用者的 Honoka Extension 是讀取**他們本地 Bridge** 裡的資料來顯示畫面，而不是直接連線到 Notion。

#### B. 寫入留言 (The Relay Mechanism)
這解答了你的疑問：「他們明明沒有 Token，留言怎麼回到 Notion？」

1.  **使用者留言**：使用者在介面上留言，這個留言會被寫入**他自己的專屬 P2P 日誌 (User Core)** 中。
2.  **超級節點偵測**：你的 Master Bridge 一直在背景監聽（Follow）這些使用者的 P2P 日誌。一旦發現有人更新了日誌（寫了新留言）。
3.  **代為發送 (Proxy Write)**：你的 Master Bridge 會把這則 P2P 留言抓下來，然後**使用你的 Notion Token，代為發送 (Relay)** 到 Notion 資料庫裡。
4.  **廣播更新**：Notion 更新後，你的 Master Bridge 再度將新狀態發佈到「公共頻道」，讓所有人都能看到這則新留言。

### P2P 在這裡的角色是什麼？
在這個設計中，**P2P 是傳輸層也是本地快取層，而 Notion 是「最終的真相來源 (Source of Truth)」與「管理後台」。** 
即使 Notion 哪天當機了，因為大家電腦裡都有一份 P2P 的備份，論壇的歷史紀錄依然完好無缺。

### 可行性評估：中等 (需較高開發成本)
*   **優點**：完美的去中心化體驗。你的伺服器負載極低（因為大家是透過 P2P 互相傳圖文，而不是塞爆你的伺服器）。免除 Notion Workspace 的限制，通知可以直接透過 P2P 觸發。
*   **缺點**：開發難度較高。必須處理「非同步寫入」的問題（例如：使用者留言後，必須等你的 Master Bridge 上線並轉發，留言才會正式進入 Notion）。

---

## 4. 總結與演進建議

*   **現階段 (Phase 1)**：我們應該先完善 **方案一 (Server Proxy)**。利用 Next.js 把論壇的 UI/UX 做滿，確保 Notion 資料庫結構穩定，並把 Next.js 打包讓 Honoka Extension 能夠讀取。
*   **下一階段 (Phase 2)**：開始改寫 `honoka-bridge`。讓 Bridge 具備「自動抓取 Notion 轉成本地檔案」的能力（這部分你的代碼已經有基礎了）。
*   **最終階段 (Phase 3)**：引入 Hyperswarm，實作 **方案二 (P2P Relay)**，讓 Notion 徹底退居幕後，成為你的專屬管理面板。
