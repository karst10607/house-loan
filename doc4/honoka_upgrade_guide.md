# Honoka 公司版升級與功能合併指南 (AI-Friendly Upgrade Guide)

> **這是一份專為 AI 與開發者設計的「特徵移植提示詞 (Prompt)」**。
> 公司環境為 Mac，個人 Lite 版環境為 Win/Linux。由於在不同實體機器上運行，Port 號衝突已不是重點。此指南的核心目的是：**如何把 Lite 版開發的「模組化架構」、「視覺剪輯器 (Visual Clipper)」與「雙頁籤 UI」無痛且安全地合併回公司的專案碼中。**

當你在公司 Mac 環境開啟 AI (如 Cursor/Gemini) 時，請提供此指南給 AI，並請它依照下列步驟執行合併：

---

## 第一階段：環境與架構準備 (Configuration Abstraction)

過去公司版的 `BRIDGE_URL` (如 `http://127.0.0.1:7749`) 是直接寫死在各個檔案中的。為了遵循 \`QA-Protocol.md\` 的 API 化原則，我們需要將其抽離。

1. **建立統一設定檔**：在公司版的 `src/` 底下新增 `config.js`：
   ```javascript
   export const Config = {
     // 公司版固定使用 7749，也可依據需求寫成從環境變數讀取
     BRIDGE_URL: "http://127.0.0.1:7749"
   };
   ```
2. **替換硬編碼 (Hardcode)**：
   請 AI 掃描公司版專案中的 `background.js`、`content.js`、`options.js` 與 `popup.js`。
   將所有寫死的 `http://127.0.0.1:7749` 替換為 `import { Config } from './config.js'` 並呼叫 `Config.BRIDGE_URL`。

---

## 第二階段：植入視覺剪輯器核心 (Feature Porting)

我們在 Lite 版已經將 MaoXian 的視覺選取功能重構為單一的模組檔案，且**已經修復了「按鈕無法點擊（事件冒泡問題）」以及「增加 Esc 鍵取消」的 Bug**。

1. **複製檔案**：將 Lite 版中的 `src/features/clipper/selector.js` 完整複製到公司版對應的路徑下。
2. **擴充權限**：因為剪輯器需要在各種不同的網頁上運作（不限於 Notion），請在公司版的 `manifest.json` 中，為 `host_permissions` 陣列加入 `<all_urls>`。

---

## 第三階段：UI 升級 (Tabbed Interface)

為了解決 Popup 介面過於擁擠的問題，Lite 版引入了「雙頁籤（Analysis 與 Clipper）」的 UI 設計。

1. **HTML 與 CSS 覆蓋**：
   直接將 Lite 版的 `popup/popup.html` 與 `popup/popup.css` 覆蓋公司版的檔案。這兩個檔案已包含現代化的 Tab 結構與 Clipper 按鈕。

2. **合併 `popup.js` 邏輯**：
   請 AI 參考 Lite 版的 `popup.js`，將以下兩塊核心邏輯移植進公司版的 `popup.js`：
   - **Tab 切換邏輯**：處理 `.tab-btn` 點擊並切換 `.tab-content` 顯示狀態。
   - **Clipper 執行與輪詢邏輯**：當點擊「開始選取」時，使用 `chrome.scripting.executeScript` 將 `selector.js` 注入當前分頁，並透過 `setInterval` 輪詢 `window.__khGetResult` 來取得使用者選取的 HTML 與圖片，最後發送 POST 請求至 Bridge 的 `/save` API。

---

## 第四階段：編譯與測試 (Build & Verify)

1. 因為 `content.js` 或 `config.js` 有變動，請務必執行套件打包：
   ```bash
   npm run build
   ```
2. 到 Chrome 擴充功能頁面點擊「重新載入」。
3. 點擊任何網頁的 Honoka 圖示，切換到「Clipper」分頁，點擊開始選取，測試是否能正常框選並存入本地端。

> **AI 執行提示**：請依照上述 1 到 4 的階段順序讀取並修改公司版的原始碼。若在合併 `popup.js` 時遇到衝突，請優先保留公司版既有的「字數分析 (Token Analysis)」邏輯，並疊加新的 Tab 與 Clipper 邏輯。
