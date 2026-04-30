# 房地產網站價格抓取驗證報告 (2026-04-30)

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
*   **實作策略**：Extension 端直接注入 Script 讀取這些變數；Bridge 端（Telegram）則需解析 HTML 中的 `<script>` 區塊。

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

## 4. Bridge 穩定性排查 (AggregateError)

*   **問題描述**：Telegram Bot 輪詢時出現 `EFATAL: AggregateError`。
*   **原因分析**：這通常發生在 Node.js 18+ 環境下，當 Telegram API 連線逾時或 DNS 解析異常時，`node-telegram-bot-api` 未妥善捕獲底層的併發錯誤。
*   **解決方案**：
    1.  在 `polling_error` 事件中實作更嚴格的冷卻機制 (Cool-down)。
    2.  確保 `EADDRINUSE` (連接埠佔用) 發生時會自動嘗試清理舊處理序。

---

## 4. 下一步計畫 (待授權)

1.  **[MODIFY] honoka-bridge/index.js**：新增 `siteRules` 物件，為不同網域定義自定義 `extractPrice` 邏輯。
2.  **[MODIFY] chrome-extension/src/content.js**：在剪輯時自動將變數中的價格寫入 `properties` 欄位。
3.  **[VERIFY]**：重新測試 Telegram 分享功能，確保價格能正確顯示在 Markdown 預覽中。

---
*報告人：Antigravity*
*日期：2026-04-30*
