# Honoka Bridge 穩定性與重啟改善計畫 (2026-04-29)

## 1. 現況分析
目前 Honoka Bridge 在 Linux 環境下以 `systemd` 服務運行，具備開機自動啟動功能。但在斷網或攜帶筆電外出時，會出現以下問題：
- **Telegram Bot 輪詢失敗**：由於是本地運行，斷網時會出現大量 `EFATAL: AggregateError`，且可能導致進程不穩定。
- **Port 衝突 (EADDRINUSE)**：重啟過程中，若舊進程未釋放 `44124` 埠號，新進程會陷入死循環崩潰。
- **重複啟動**：缺乏單一實例（Single Instance）鎖定機制，導致多個主進程可能同時運行。

## 2. 改善目標
- [x] **單一實例鎖定**：使用 PID 檔案確保同時只有一個 Bridge 主進程在執行。
- [ ] **埠號搶佔優化**：若啟動時發現埠號被佔用，自動嘗試清理舊的殘留進程。
- [ ] **斷網自適應**：優化 Telegram Bot 的錯誤處理，在網路斷開時進入「靜默等待」模式，而非持續報錯或崩潰。
- [ ] **狀態監控**：在 Bridge UI 提供更清晰的「連線狀態」指示（包括 Telegram 連線狀態）。

## 3. 具體實施步驟

### A. 引入 PID Lock 機制
在 `index.js` 的 `cluster.isPrimary` 階段加入：
- 檢查 `~/.honoka-docs/.honoka/bridge.pid`。
- 如果 PID 存在且對應進程正在運行，則新進程自動退出，避免重複。

### B. 埠號衝突處理
在 `server.listen` 失敗（`EADDRINUSE`）時：
- 執行 `fuser -k 44124/tcp` 或類似邏輯，嘗試強制關閉舊的佔用者後重試啟動。

### C. Telegram Bot 錯誤抑制
- 修改 `polling_error` 的處理邏輯，當偵測到無網路（ECONNREFUSED/ETIMEDOUT）時，自動拉長輪詢間隔，減少日誌噪音。

## 4. 常見問題解答 (FAQ)
- **Q: 目前開機就會自動啟動嗎？**
  - **A:** 是的。系統中已配置 `honoka-bridge.service`，開機後會自動以你的用戶身份運行。
- **Q: Extension 上的 "Restart Honoka" 有什麼用？**
  - **A:** 它會發送指令讓目前的 Bridge 進程重啟。這在修改設定（如更換 Bot Token）或程式卡住時非常有用。
- **Q: 下午沒存下來的 link 還能找回來嗎？**
  - **A:** 如果機器人在 24 小時內恢復連線，Telegram 伺服器理論上會重傳。請確保目前的 Bridge 運行正常且埠號沒有互打。
