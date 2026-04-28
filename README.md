# House Loan & Honoka Lite Project

這是一個整合了房屋貸款研究、個人知識庫與 AI 輔助工具的綜合型專案。

## 專案核心模組

### 1. Honoka Lite (Chrome 擴充功能與 Bridge 伺服器)
這是一個位於 `honoka-lite/` 的個人化知識庫擷取工具，包含：
- **視覺剪輯器 (Visual Clipper)**：移植自 MaoXian 的網頁內容選取功能，支援多區塊選取、圖片自動下載與 Markdown 格式化。
- **動態 Port 橋接 (Bridge Server)**：透過 Node.js 執行的背景服務，自動將網頁內容存入本地 `~/honoka-docs` 目錄。
- **環境自適應**：自動偵測環境 (Lite vs Company) 並切換通訊埠 (44124 vs 7749)。

### 2. 房屋貸款追蹤 (Budget & Loan Tracking)
位於 `Budget track/` 的財務紀錄與分析文件。

### 3. 文件與協議 (Docs)
- **QA-Protocol.md**：專案開發與同步的品質保證標準。
- **Honoka Upgrade Guide** (位於 `doc4/`)：Lite 版新功能合併至公司專案的指引。

---

## 快速開始 (Honoka Lite)

### Linux 環境
1. **安裝 Bridge 伺服器**：
   ```bash
   cd honoka-lite
   ./install-linux.sh
   ```
   這會將 Bridge 註冊為 `systemd` 服務並設定為 `Restart=always`。現在你可以直接透過 Honoka 介面上的 **Restart Bridge** 按鈕來重啟服務。

### Windows 環境
1. **執行 Bridge 伺服器**：
   在 `honoka-lite/honoka-bridge` 目錄下執行：
   ```cmd
   node index.js
   ```
2. **自動重啟建議**：
   Windows 預設不支援 systemd。若要讓介面上的 **Restart Bridge** 按鈕生效（即程式結束後自動重新啟動），建議建立一個 `.bat` 檔來執行：
   ```cmd
   :start
   node index.js
   goto start
   ```

### 安裝 Chrome 擴充功能 (跨平台通用)
1. 開啟 Chrome 進入 `chrome://extensions`。
2. 啟動「開發者模式」。
3. 「載入解壓縮的擴充功能」，選擇 `honoka-lite/chrome-extension`。

---

## 開發規範
所有代碼異動必須遵循 `docs/QA-Protocol.md`，特別是環境判定必須依賴 `manifest.name` 而非版本號。

---

## 更新紀錄 (Change Log)

### v1.1.0 (2026-04-28) — 架構重構：Clipper 終於能存了！
- **根治 Clipper 完全無法存檔的根本原因**：發現 Chrome Extension 的 popup 視窗在使用者點擊網頁去選取區塊的瞬間會被系統強制關閉，導致 popup 中的 polling 計時器直接消失，選完的內容永遠沒有人接收。
- **解決方案**：將 Clipper 的核心邏輯（注入選取器、輪詢結果、傳送至 Bridge）全部搬進 `background.js` (Service Worker)。Service Worker 不會因為 popup 關閉而被終止，確保整個剪輯流程從頭到尾都能完成。
- **改善使用體驗**：現在點擊「開始框選」後，popup 會提示你「可以關閉此視窗，放心去選取」。選取完成後，背景會自動儲存，不再需要 popup 保持開啟。

### v1.0.9 (2026-04-28)
- **根治 Clipper 無法存檔問題**：`turndown` 套件未安裝導致 Bridge 在收到 HTML 資料時 crash。已在 `honoka-bridge` 目錄執行 `npm install turndown` 完成安裝，並驗證 HTML→Markdown 端到端轉換正常運作。
- **修正錯誤被靜默吞噬**：`popup.js` 的 polling 迴圈的 `catch` 過去完全靜默（即使 Bridge 崩潰也看不到錯誤訊息），現在已改為在介面上顯示 `❌ 錯誤: xxx`，未來絕不再有無聲無息的失敗。

### v1.0.8 (2026-04-28)
- **修正 Bridge 重啟崩潰**：修正 `install-linux.sh` 中 systemd 的重啟策略。原本為 `Restart=on-failure` 導致介面點擊「Restart」後（正常退出 code=0）服務不再自動重啟。現已改為 `Restart=always`，並已即時修復你的背景服務。
- **補回 Markdown 轉換器 (Turndown)**：原來你舊版的 Clipper 有一個專屬後端（Port 44123）在做 HTML 到 Markdown 的轉換！在整合進 Honoka 後，這段轉換邏輯遺失了，導致只存了 HTML。現在我已經把 `turndown` 轉換器完美內建到 `honoka-bridge` 的 `/save` 流程中，剪輯下來的內容終於能正常轉成 Markdown 存檔了！

### v1.0.7 (2026-04-28)
- **修正 Clipper 崩潰 Bug (二次修正)**：徹底清除 `popup.js` 檔案中殘留的第二個 `import` 語句，徹底解決 Chrome 嚴格模式下報錯導致 Tab 分頁無法切換與按鈕失效的問題。

### v1.0.6 (2026-04-28)
- **修正 Clipper 崩潰 Bug**：修正 `popup.js` 中 `import` 語法位置錯誤，導致嚴格模式下（Strict Mode）無法掛載按鈕監聽器的致命錯誤。現在按鈕可正常觸發剪輯與進度回報。

(clipper 目前限制：無法抓google doc, 須匯出為html pack 之後再轉md + pics來加入local doc)

### v1.0.5 (2026-04-28)
- **全面移除寫死版號**：全面確認並移除 `config.js` 等底層代碼中殘留的 `1.0.X` 版本號判定邏輯。環境判定 (Lite vs 遠端) 現在統一依賴 `manifest.name`，徹底解決版號升級導致的 Bridge 斷線問題。
- **Clipper 介面進化**：新增「儲存目錄」輸入框，支援自訂本地分類資料夾；並實作了即時進度與狀態提示（成功與錯誤回報）。

### v1.0.4 (2026-04-28)
- **修正服務重啟**：Linux 環境將 Bridge 服務設定為 `Restart=always`，支援透過介面按鈕秒重啟。
- **文件更新**：新增 Windows 環境執行建議與自動重啟 `.bat` 腳本範例。

### v1.0.3 (2026-04-28)
- **修正 Clipper 儲存**：修正前端 payload 欄位名稱對應錯誤（`html` -> `markdown`），解決剪輯內容無法正確存入本地的問題。
- **穩定化**：確保圖片列表正確映射至 Bridge 儲存路徑。

### v1.0.2 (2026-04-28)
- **環境判定進化**：將環境判定邏輯從「版本號比對」遷移至「擴充功能名稱比對 (`manifest.name`)」。
- **修正斷線 Bug**：解決當版本號從 1.0.0 升級後，擴充功能會因判定失效而意外連向公司版 Port (7749) 的問題。

### v1.0.0 (2026-04-27)
- **Honoka Lite 初始版本發佈**：支援獨立 Port (44124) 與本地 Bridge 儲存。

