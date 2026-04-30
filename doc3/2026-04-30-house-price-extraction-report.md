# 房地產網站價格抓取驗證報告 (v1.4.6, 2026-04-30)
本文件記錄針對 591、永慶房屋、大家房屋等平台價格抓取機制的驗證結果，並提供具體的技術路徑。

---

## 1. 驗證總結

| 網站名稱 | 網址範例 | 抓取狀態 | 技術手段 |
| :--- | :--- | :--- | :--- |
| **591 售屋網** | `sale.591.com.tw` | **確定可行** | **全欄位混淆** (價格/坪數/樓層)，需解析 `window.dataLayer` 或 `window.__INITIAL_STATE__`。 |
| **永慶房仲網** | `buy.yungching.com.tw` | **確定可行** | DOM 為明文，亦可從 `window.dataLayer` 穩定獲取所有資訊。 |
| **大家房屋** | `great-home.com.tw` | **確定可行** | 目前 DOM 為直接明文，數據層結構完整。 |

---

## 2. 網站細部分析

### A. 591 售屋網 (混淆層級：高)
*   **現象**：除了價格之外，**坪數** (`<wc-obfuscate-floor>`)、**樓層** (`<wc-text-floor0>`) 以及**格局/地址**也全部使用了自定義標籤，導致純文字爬蟲失效。
*   **破解路徑**：
    1.  **GTM 數據層 (推薦)**：在 Console 執行 `window.dataLayer` 可發現以下明文欄位：
        *   `price_name`: 價格 (如 "2,980萬")
        *   `area_name`: 坪數 (如 "26.77")
        *   `floor_name`: 樓層 (如 "10")
        *   `layout_name`: 格局 (如 "2房2廳2衛")
    2.  **初始狀態變數**：`window.__INITIAL_STATE__` 包含了房屋詳情的所有 JSON 數據。
*   **實作策略**：
    1.  **Extension 端**：直接注入 Script 讀取這些變數。
    2.  **Bridge 端 (Telegram)**：採用 **Playwright 背景渲染** 模式。啟動 Chromium 載入頁面後，執行 `window.dataLayer` 萃取，並在背景自動補回 Markdown 檔案。
    3.  **動態命名支援**：系統已實現存檔核心與注入邏輯的去耦合，支援未來變更 Slug 命名策略，不再寫死 `index.md`。

### B. 永慶房仲網 (混淆層級：低)
*   **現象**：價格直接以 `<span>` 或 `<strong>` 標籤呈現，無加密。
*   **破解路徑**：
    1.  **CSS Selector**：`.house-info-price` (範例)。
    2.  **數據層**：`window.dataLayer` 中包含 `price` 欄位。
*   **實作策略**：通用抓取即可。

### C. 大家房屋 (混淆層級：無)
*   **現象**：純 HTML 渲染。
*   **破解路徑**：
    1.  **CSS Selector**：直接抓取 `.price` 相關類名。
*   **實作策略**：通用抓取。

---

## 3. 全新功能：整頁擷圖與 PDF 存檔

針對房屋資訊的長期保存，將新增自動化擷圖功能：
*   **核心技術**：在 Bridge 端整合 **Playwright**。
*   **自動化流程**：
    1.  **自動捲動**：擷圖前自動執行 JavaScript 將頁面捲動到底部，觸發 591/永慶等網站的圖片延遲載入 (Lazy-load)。
    2.  **整頁擷圖 (PNG)**：生成全解析度的頁面長圖，方便快速預覽。
    3.  **PDF 存檔**：將頁面轉換為 PDF 格式，保留文字與佈局，方便離線查閱或列印。
*   **儲存位置**：與 Markdown 文件存放在同一資料夾內，檔案名固定為 `fullpage.png` 與 `fullpage.pdf`。

---

## 4. Bridge 穩定性優化與擷圖整合

*   **Telegram 穩定性**：已修復 `AggregateError` 導致的崩潰問題，並加入連線錯誤冷卻機制。
*   **擷圖 API**：實作了 `/api/capture` 端點，整合 Playwright 支援：
    *   **全頁長圖 (PNG)**：自動處理 Lazy-load。
    *   **PDF 存檔**：高品質向量佈局保存。
*   **Extension 整合**：新增 `📸` 按鈕，點擊即可同步觸發「文字存檔 + 整頁擷圖 + PDF 生成」。

---

## 5. 實作現狀 (2026-04-30 完工)

1.  **[DONE] 自動價格抓取**：已在 `honoka-bridge` 加入 `SITE_RULES`，支援從 `window.dataLayer` 提取 591/永慶 的價格、坪數、樓層與格局。
2.  **[DONE] 混淆破解**：即使 DOM 被混淆 (wc-obfuscate)，仍能從內嵌的 Script 資料層獲取 100% 正確的明文數據。
3.  **[DONE] 擷圖與 PDF**：Playwright 服務已上線，所有房屋物件均可保存完整視覺快照。
4.  **[DONE] Telegram 強化**：透過 Telegram 傳送網址，Bot 會自動回報提取到的價格資訊。

---
*報告人：Antigravity*
*日期：2026-04-30*
