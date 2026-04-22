# 房貸助手 (House Loan Helper)：去中心化知識架構 Roadmap

本專案旨在打造一個「本地優先 (Local-First)」、「雲端同步 (Notion Mirror)」且具備「P2P 社交屬性 (Pear Distribution)」的現代化知識管理生態。

---

## 🌟 核心架構願景：雙三層共存 (Triple-Layer Architecture)

我們不只做剪貼工具，而是要解決「資料主權」與「協作便利」的矛盾：
1.  **資料主權層 (Local Core)**：以「葉子束 (Leaf Bundle)」規範存儲的本地 Markdown 與 Assets 檔案。這是唯一的 Single Source of Truth。
2.  **雲端鏡像層 (Notion Mirror)**：將本地內容異步同步至 Notion，提供強大的 UI、跨裝置瀏覽與團隊協作能力。
3.  **分散式社交層 (P2P Social)**：利用 Pear (Hyperstack) 將存剪內容轉化為 P2P 訊息流，實現如同 Twitter 般的去中心化追蹤與互動。

---

## 📍 發展里程碑 (Milestones)

### 🏗️ Phase 1：本地核心與 Notion 自動同步 (當前實作中)
建立穩固的本地存儲與雲端鏡像通道。
- [x] **SSH 與 GitHub 自動化環境設定**：解決推播連線問題。
- [x] **基於 RxDB 的 Knowledge Hub 背景服務**：
    - 接手 Clipper 傳來的 HTML 資料。
    - 實作「年/月/日-Slug」Leaf Bundle 自動存檔。
    - 內建 RxDB 索引，支援快速檢索與 Persistence。
    - 提供 `/api/clips` 介面供前端論壇調用。
- [x] **Social Wall (初版論壇介面)**：
    - 建立 `forum.html` 展示所有擷取的內容。
    - 支援自動下載圖片並在論壇中顯示。
    - 採用現代化玻璃擬態 (Glassmorphism) 設計。

### 🔗 Phase 2：擴充功能整合與雙向同步
管理多個入口，統一知識輸入路徑。
- [ ] **Notion 提取器整合**：整合現有的「Notion 文章提取 Chrome Extension」，讓存儲在 Notion 的內容也能反向同步回本地做備份。
- [ ] **雙向同步機制**：確保本地修改與 Notion 修改能保持最終一致性。

### 📡 Phase 3：P2P 社交層與分散式分發
將個人筆記轉化為社交貨幣。
- [ ] **Pear P2P Feed**：利用 `Hypercore` 建立個人動態流。
- [ ] **分散式圖床**：利用 `Hyperdrive` 直接將本地 `assets/` 資料夾 P2P 化。
- [ ] **互動系統**：基於 `Hyperbee` 的去中心化留言、Fav 與轉發功能。

### 🧠 Phase 4：智慧化檢索與 Local AI
讓你的知識庫真正被「讀懂」。
- [ ] **Local RAG (檢索增強生成)**：引入本地向量資料庫（如 SQLite-vec）。
- [ ] **P2P 向量同步**：實現在不同節點間同步向量索引，讓 AI 知識庫也能分散式共享。
- [ ] **AI 知識整理助手**：自動根據剪貼內容生成摘要、標籤與關聯圖譜。

---

## 🔑 核心技術選型
- **Runtime**: Node.js (Background), Chrome Extension (Frontend)
- **Primary Auth**: Notion API Secrets & SSH Keys
- **P2P Stack**: Pear, Hypercore, Hyperswarm, Hyperdrive
- **Conversion**: Turndown (HTML to MD)
- **Sync**: Dropbox / Qsync (FileSystem Level)
