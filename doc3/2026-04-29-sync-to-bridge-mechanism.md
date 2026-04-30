# Honoka: Sync to Bridge 與 Inbox 機制說明
**日期：** 2026-04-29

## 1. Sync to Bridge 的功能是什麼？
`Sync to Bridge` 的主要功能是**將 Honoka Chrome 擴充功能中紀錄的 Notion 頁面歷史資料，完整備份推送到本地端執行的 Bridge 伺服器進行持久化儲存（Durable Storage）。**

- **避免資料遺失**：Chrome 擴充功能暫存的歷史紀錄（History）存在瀏覽器中，如果瀏覽器暫存被清空或擴充功能重裝就會消失。透過這個功能，可將資料傳給 Bridge 保存。
- **傳輸流程**：當點擊該按鈕時，會讀取擴充功能內所有已紀錄的 `allHistory` 頁面資料，透過 `/history/ingest` 的 API 端點，逐一發送到運作中的 Bridge 伺服器端。
- **後續分析與備份**：上傳到 Bridge 後，這些歷史資料能作為備份，或是利用 Bridge 提供的 Analytics Dashboard（分析圖表）檢視歷史紀錄數據。

## 2. 新功能（Clipper、Telegram Bot、下載影片）需要 Sync 嗎？
**不會包含在內，且它們不需要透過這個按鈕來 Sync。**

`Sync to Bridge` 的範圍僅限於「在 Notion 上瀏覽過的頁面歷史紀錄（History）」。新功能的運作機制與歷史紀錄不同：
- **Clipper (本地抓文章)**：在網頁上使用 Clipper 擷取內容時，擴充功能會直接呼叫 Bridge 的 API，當下就把圖文資料寫入本地端的資料夾（如 Inbox 或 Docs）。它不會停留在 Chrome 的暫存中，因此不需要透過 `Sync to Bridge` 備份。
- **Telegram Bot 與 影片下載**：這些功能直接運行在 Node.js 後端（Bridge 本身），或直接將檔案下載、寫入本地系統硬碟，因此不需要經過同步按鈕。

## 3. Telegram Bot 下載的文章為何能直接顯示在 Inbox？
這背後的機制非常單純，主要是因為 Bridge 採用了**「直接掃描本地資料夾（File System）」**的架構：

1. **Bot 直接寫入 Inbox 資料夾：**
   Telegram Bot 完成抓取後，底層會呼叫 `saveToDisk()` 函數並標註 `source: "telegram"`。
   程式邏輯 `const baseDir = (source === "clip" || source === "telegram") ? INBOX_DIR : DOCS_DIR;` 會自動把 Markdown 檔案和圖片打包，直接儲存到電腦上的 Inbox 資料夾內。
2. **UI 介面即時掃描資料夾：**
   打開 Honoka 介面或擴充功能面板時，前端會發送 `/list` 請求。Bridge 伺服器處理時，會直接透過 `fs.readdirSync` 即時掃描硬碟上的 `DOCS_DIR` 與 `INBOX_DIR`。
3. **合併與呈現：**
   Bridge 掃描完後，把子資料夾當作一篇文章，讀取 `index.md` 取得 Metadata 並回傳給前端。前端只要發現屬性來自 Inbox，就會顯示在「Inbox」區塊中。

總結來說，Telegram Bot 的抓取結果直接變成硬碟裡的實體檔案，使用者介面也是直接去硬碟讀取，完全不需要額外執行任何同步（Sync）動作。
