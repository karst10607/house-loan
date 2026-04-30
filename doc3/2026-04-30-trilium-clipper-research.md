# Trilium Web Clipper 機制研究與改進方案報告

本文件旨在分析 Trilium 官方 Web Clipper 的運作機制，並探討如何將其優點引入目前的 **Honoka Bridge** 系統中，以提升圖片的離線保存品質與同步效率。

---

## 1. 核心機制對比

| 功能特性 | **Trilium 官方 Clipper** | **目前的 Honoka Bridge** |
| :--- | :--- | :--- |
| **圖片存取策略** | **Base64 打包傳輸**：在瀏覽器端將圖片下載並轉為 Base64 字串。 | **後端直接下載**：由伺服器（Bridge）根據 URL 下載至硬碟。 |
| **HTML 處理** | **佔位符替換**：將 `<img>` 的 `src` 換成自定義 ID（如 `image_1`）。 | **路徑替換**：將 `src` 換成本地相對路徑（如 `./images/x.png`）。 |
| **儲存位置** | **資料庫內部 (SQLite)**：圖片以二進位 (Blob) 形式存於 `document.db` 中。 | **硬碟檔案系統**：圖片以獨立的 `.png/.jpg` 檔案存在資料夾內。 |
| **同步 API** | 使用專用的 `/api/clipper/clippings` 接口。 | 目前使用檔案寫入與 Markdown 連結。 |
| **離線能力** | **極高**：圖片與筆記一體化，不依賴外部檔案。 | **高**：依賴本地路徑，但在非 Trilium 環境下更容易預覽。 |

---

## 2. 關於圖片格式的釐清

> [!IMPORTANT]
> **Trilium 的圖片真的是 Base64 嗎？**
> 不完全是。Base64 只是 **「傳輸過程」** 中使用的包裝。
> 1. **傳輸時：** 為了把 HTML 和多張圖片塞進同一個 JSON 請求發送給 API，Clipper 會把圖片轉成 Base64。
> 2. **儲存時：** Trilium 伺服器收到後，會把它還原成二進位數據 (Binary) 存入 `document.db` 資料庫檔案中。
> 
> **與 Honoka 的差異：**
> Honoka 的設計初衷是「檔案透明化」，所以我們**堅持將圖片存成硬碟上的圖檔**（例如 `.png`, `.jpg`）。這對於使用 Cursor 編輯、Git 備份或在其它 Markdown 編輯器（如 Obsidian）中查看是非常友好的。

---

## 3. 核心戰略轉向：優先強化 Honoka 本地存檔能力

根據 2026-04-30 的討論，我們將暫緩「同步到 Trilium」的實作，轉而**優先將從研究中獲得的技術經驗，用於強化 Honoka Bridge、Honoka Clipper 與 Telegram Bot 的抓取深度**。我們的目標是讓本地硬碟存下來的檔案達到「專業剪輯」的水準。

### A. 強化本地儲存與抓取邏輯
*   **本地優先：** 確保 `saveToDisk` 邏輯能應對各種動態載入的挑戰。
*   **規則驅動：** 為不同房地產網站（591、永慶、大家房屋）建立專屬的「圖片高清化」與「相簿全抓取」規則。
*   **跨端一致：** 無論是 Telegram bot 丟連結，還是瀏覽器點 Clipper，都應獲得同樣完整的圖片資源。

### B. 核心改進原則：
*   **高清化 (High-Res)**：偵測縮圖參數並自動移除或替換。
*   **防盜鏈繞過 (Referer)**：所有圖片請求必須模擬來源網域。
*   **深度挖掘 (JSON/JS)**：從 `window.__INITIAL_STATE__` 或隱藏屬性提取隱藏相簿。

### B. 模擬 Clipper API 接口
目前將內容傳給 Trilium 時，如果只傳 Markdown，Trilium 往往無法正確抓取圖片。
*   **方案：** 我們應該模擬 `trilium-web-clipper` 的行為，直接呼叫 `/api/clipper/clippings` 接口。
*   **優點：** 這樣不需要手動在 Trilium 裡建立一堆子筆記，Trilium 的伺服器會自動根據我們提供的 ID 映射，把圖片「嵌入」到正確的筆記位置。

### C. 提升 Telegram 與跨平台抓取的穩定性
*   **Telegram 抓取：** 由於 Telegram bot 運作於後端，無法模擬點擊。我們將實作 **「網址預測規則」**（如大家房屋的 `smallpictures` -> `pictures`），讓後端能直接抓到隱藏的大圖。
*   **Clipper 抓取：** 運作於瀏覽器前端。我們將實作 **「自動觸發機制」**（如自動點擊永慶房仲的『格局圖』標籤），確保動態載入的內容在傳送給 Bridge 前就已存在於 DOM 中。

---

## 4. 房地產網站相簿 (Carousel) 專項研究結果

針對用戶提到的三個主要網站，我們分析出以下精確的抓取改進點：

### A. 591 售屋網 (sale.591.com.tw)
*   **關鍵屬性：** 圖片網址後綴帶有 `!600x600.jpg`（或類似尺寸）參數。
*   **改進策略：** 抓取時自動移除後綴以獲取原始高清圖；下載時必須帶入 `Referer: https://sale.591.com.tw/`。
*   **深度抓取：** 解析 `window.__INITIAL_STATE__` 變數，獲取藏在 JS 裡的完整 20+ 張相簿圖片。

### B. 永慶房仲網 (buy.yungching.com.tw)
*   **關鍵屬性：** 圖片網址帶有尺寸參數 `&width=1024&height=768`。
*   **改進策略：** 抓取後自動將 `width` 修改為 `2048` 或更高，以獲取原始高清圖。
*   **動態內容：** 必須掃描 `data-src` 屬性，並模擬觸發「格局圖」分類標籤。

### B. 大家房屋 (www.great-home.com.tw)
*   **關鍵屬性：** 使用 `bxslider` 元件，大圖與縮圖路徑僅差一個資料夾名稱。
*   **改進策略：** 實作字串替換邏輯：`smallpictures` ➔ `pictures`。
*   **全量掃描：** 掃描 `.bx-viewport` 內的所有縮圖，將其全數轉換為大圖網址並加入下載隊列。

---

## 5. 關於 Repository 的補充

*   **官方主體：** [TriliumNext/Trilium](https://github.com/TriliumNext/Trilium) 是目前社群維護的主專案。
*   **Clipper 組件：** Web Clipper 是一個獨立的 Repo ([Nriver/trilium-web-clipper-plus](https://github.com/Nriver/trilium-web-clipper-plus))。
*   **研究價值：** 我們參考 Clipper 的原始碼是為了學習其 **API Payload 結構**，這樣我們才能讓 `honoka-bridge` 偽裝成 Clipper，與 Trilium 達成最完美的通訊。以及把圖片以檔案形式完整存在硬碟（對應原本的文件作為附件）的結構，再傳給Trilium或md viewer讓它重新組裝，也是參考Clipper的 API Payload 結構

## 6. Notion 同步的可行性評估與需求

若未來計畫將 Honoka 的備份內容同步到 Notion 建立文件，僅有 Notion Token 是不足夠的。以下是核心需求：

### A. 圖片儲存的外部化
*   **痛點**：Notion API 不支援直接上傳本地二進位圖檔到頁面區塊中。
*   **需求**：必須擁有一個「公開圖床」或「雲端空間」（如 S3, Cloudinary, 或 GitHub），Bridge 需先上傳圖片取得公用網址，Notion 才能顯示圖片。

### B. 資料格式轉換 (Blocks API)
*   **痛點**：Notion 不接受 Markdown/HTML 原始碼，它使用自有的 Block JSON 格式。
*   **需求**：需實作或引入 `HTML/MD ➔ Notion Blocks` 的轉換邏輯，否則無法保留排版。

### C. 基礎設施準備
*   **Internal Integration Token**：身分驗證用。
*   **Database ID**：必須先建立目標資料庫。
*   **Connection 授權**：必須在 Notion UI 中手動將 Integration 加入該資料庫的權限名單。

### D. 使用 NAS (如 QNAP) 作為圖床的限制
*   **局域網 (LAN) 的侷限性**：若使用 `192.168.x.x` 的內部網址，Notion 的雲端伺服器無法存取該圖片，會導致除本機外的裝置（如手機、異地電腦）全部破圖。
*   **解決方案**：
    *   **Cloudflare Tunnel**：將 NAS 特定資料夾安全地暴露給外網，產生穩定且加密的 HTTPS 網址。
    *   **Tailscale Funnel**：利用 P2P 隧道技術將本地資源公開化。

## 7. 替代方案：兼顧協作與資料主權

若希望獲得類似 Notion 的體驗但又要保留資料主權，可考慮以下「自建型」方案：

1.  **Affine (推薦)**：支援 Docker 安裝於 NAS，介面極度接近 Notion，且整合白板功能。
2.  **Anytype**：本地優先、P2P 加密同步，適合個人與小型團隊的高隱私協作。
3.  **AppFlowy**：開源版 Notion 複製者，適合喜歡原生應用的用戶。

## 8. 數據主權與 AI 可讀性 (RAG/向量化) 深度評估

這是用戶最核心的擔憂：**「資料是否會被綁架在特定軟體中？」**

### A. AI 向量化能力對比
| 特性 | Honoka (本地 Markdown) | Trilium (SQLite 資料庫) |
| :--- | :--- | :--- |
| **AI 直接讀取** | **極佳**。本地 AI (RAG) 工具可直接掃描檔案。 | **困難**。需透過 API 或 SQL 連線才能讀取。 |
| **圖片理解** | **極佳**。多模態 AI 可依路徑讀取實體圖檔。 | **極差**。圖片封裝在 Blob 中，AI 無法直接存取。 |
| **資料分段** | 簡單 (標準 Markdown 結構)。 | 複雜 (需先剝離 HTML 標籤)。 |

### B. Trilium 資料的「逃生艙」機制
若擔心資料被綁死在 Trilium 中，有以下還原手段：
1.  **批次還原圖片**：透過 Trilium 內建的 `Export ➔ Markdown` 功能，所有的 Blob 會自動解碼回實體 `.jpg/.png` 並存入 `assets` 資料夾。
2.  **腳本提取**：可撰寫簡易 Node.js 腳本讀取 `document.db`，直接批次導出所有圖片二進位數據。

### C. 解碼 Trilium 資料庫 (SQLite) 的技術難度與挑戰
若不使用 Honoka 的實體檔案，而是試圖讓 AI 直接讀取 Trilium DB，將面臨以下困難：

1.  **結構關聯複雜 (Schema Mapping)**：
    *   Trilium 將「筆記內容」與「圖片數據 (Blobs)」儲存在不同的資料表中。要還原出一篇「圖文並茂」的文章，需要撰寫複雜的 SQL Join 語句。這對大多數現成的 AI RAG 工具來說是無法直接完成的。
2.  **HTML 雜訊處理 (Preprocessing)**：
    *   資料庫中存儲的是帶有大量標籤的 HTML。AI 在讀取時會消耗過多 Token 於無意義的 `<div>` 或 `<span>` 標籤上。要達到 AI 高效理解，必須先實作一套「HTML ➔ Markdown」的清洗程式。
3.  **高昂的維護成本**：
    *   這是一條「高維護」的路徑。一旦 Trilium 更新資料庫架構 (Schema)，你辛苦撰寫的解碼程式就會失效。
4.  **結論**：
    *   **「解碼資料庫」是事後補救，「存成 Markdown」是源頭優化。** 為了 AI 的長久相容性，我們應堅持後者。

---

## 9. 最終共識與下一步行動

**核心原則：Honoka 檔案系統是唯一的「真理來源 (Source of Truth)」。**

1.  **維持 Markdown + 實體圖檔**：這是為了確保未來十年內，無論 AI 技術如何演進，你的資料都能被直接讀取與向量化。
2.  **Trilium 作為「展示層」**：利用它的 API 將 Honoka 的內容「投影」進去，供日常視覺化查詢與整理使用。
3.  **優先強化本地抓取**：
    *   實作 591/永慶/大家房屋的高清圖下載規則。
    *   優化 `index.js`，讓下載過程能自動補完隱藏相簿，並確保檔案名稱與路徑符合 AI 掃描的最佳實踐。

---

## 10. 關於 Repository 的補充

目前研究顯示，**Trilium** 的 API 結構與我們的「本地檔案優先」邏輯最為契合（支援 Base64 與直接附件傳輸）；而 **Notion** 同步則需要額外的圖床基礎設施，開發成本較高。

**當前共識：**
1.  **暫緩同步實作**：優先將精力放在強化 Honoka 本地的抓取深度（591、永慶、大家房屋）。
2.  **規則引擎化**：將網站專屬的破解規律模組化，提昇硬碟備份的品質。
3.  **參考 Clipper 結構**：利用 Clipper 的 Payload 設計來優化本地圖片與文件的組裝關聯。

---
*記錄日期：2026-04-30*
*狀態：研究完成，待實作規劃*
