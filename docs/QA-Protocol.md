# 專案 QA 通過標準 (Persistence & Sync Protocol)

為了確保 P2P 知識庫的可靠性，所有未來的版本發布必須通過以下測試項目：

## 1. 數據持久化測試 (Persistence Test)
- [ ] **動作**：擷取任何網頁並上傳一個檔案。
- [ ] **檢查**：
  - 重啟 App 後，該檔案是否依然顯示在列表中？
  - 重啟 App 後，該檔案是否依然能正確點開預覽？

## 2. 實體資料夾同步測試 (Sync Test)
- [ ] **動作**：設定本地同步資料夾。
- [ ] **檢查**：
  - 新擷取的網頁 Markdown (.md) 是否在 5 秒內出現在本地硬碟？
  - 在本地硬碟手動丟入一個 PDF，App 的文件列表是否自動出現該檔案？

## 3. 軟刪除恢復測試 (Soft Delete Test)
- [ ] **動作**：從本地資料夾刪除一個同步檔案。
- [ ] **檢查**：
  - 檔案是否從本地消失，但 Hyperdrive 的 `/.trash/` 目錄中仍保有該備份？

---
> [!IMPORTANT]
> **開發者守則**：未通過上述測試的代碼嚴禁合併至生產分支。



開發規劃

Searched web: "notion api integration setup guide 2024 2025 2026"

針對 Notion API 的設定與測試，我為你整理了一份詳細的分析與操作指南。在我們正式撰寫自動同步代碼之前，確保這些基礎設施正確連通是非常重要的。

### 📄 Notion API 整合分析報告

這份報告涵蓋了從環境設定到模擬測試的全過程。

#### 1. 核心設定流程 (The Integration Setup)
Notion API 的安全機制分為三個層次：
*   **Integration (機器人)**：你需要到 [Notion Developers](https://www.notion.so/my-integrations) 建立一個私有的 Integration，這會產生一個 `Internal Integration Secret`（你的登入金鑰）。
*   **Capabilities (權限)**：設定時，必須開啟 **Read**, **Update**, 與 **Insert Content**。
*   **Grant Access (分享權限)**：這是最重要的一步。你必須在 Notion 頁面中，手動將該 Integration 「加入 (Invite/Connect)」到目標 Database，否則 API 即使有金鑰也進不去。

#### 2. 定位目標：Database ID
API 跟人不同，它需要一個精確的 32 位元代號。
*   **獲取方式**：在瀏覽器打開你的資料庫（Full Page 模式），網址通常長這樣：
    `https://www.notion.so/myworkspace/a8aec43384f447ed84390e62d498913c?v=...`
*   中間那串 `a8aec43384f447ed84390e62d498913c` 就是你的 **Database ID**。

#### 3. 測試連結性 (Testing without Code)
在寫 JavaScript 之前，我們可以用系統內建的 `curl` 指令來測試金鑰是否有效。
*   **連線測試指令**：
    透過終端機對 `https://api.notion.com/v1/databases/你的ID` 發送 GET 請求。
*   **成功指標**：如果回應回傳了資料庫的標題與欄位定義 (JSON 格式)，表示設定完全正確。

#### 4. 資料映射邏輯 (Data Mapping Analysis)
這部分是開發的核心邏輯，我們需要把本地的原始資料對應到 Notion 的結構：

| 本地 (Markdown / Leaf Bundle) | Notion API 區塊類型 |
| :--- | :--- |
| **YAML Frontmatter: title** | Page Property: `title` (Name) |
| **YAML Frontmatter: url** | Page Property: `url` |
| **YAML Frontmatter: clipped_at** | Page Property: `date` |
| **# 標題 1** | Block Type: `heading_1` |
| **一般內文** | Block Type: `paragraph` |
| **assets/image.png** | Block Type: `image` (使用 File Upload 模式) |

#### 5. 圖片上傳的關鍵 (Image Upload Strategy)
Notion 的圖片上傳 API 分為兩階段：
1.  **Create Upload**：先告訴 Notion 我要上傳一個檔案，Notion 會還你一個 `ID`。
2.  **Send Bytes**：把本地圖片的二進位數據 (Binary) 傳到該 ID 對應的位址。
3.  **Attach**：建立頁面時，將這個成功的 `upload_id` 關聯到 Image Block。

---

### 下一步建議
你可以先嘗試在 [Notion Developers](https://www.notion.so/my-integrations) 建立 Integration，並把產生的 **Secret** 與你的 **Database ID** 記下來（但先不要貼給我，我們會放在本地的 `.env` 檔案中）。

**如果你對上述的映射邏輯（例如：有哪些欄位需要進 Notion Database）有特定想法，歡迎提出來討論！**