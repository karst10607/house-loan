# 房貸助手 + 知識剪輯系統 🏠🧠

一個整合**房貸計算器**與**本地 Knowledge Hub** 的工具，支援網頁剪輯、視覺化框選、Markdown 存檔，以及 Social Wall 論壇閱讀介面。

---

## ✨ 功能總覽

- 🔢 房貸試算：本息均攤 / 本金均攤，含逐月明細
- 🧠 本地 Knowledge Hub：接收 Chrome Clipper 資料，存入本地 Markdown
- 🎯 視覺框選 Clipper：可在頁面上點選想要的區塊，只儲存乾淨內文
- 📰 Social Wall 論壇介面：Mobile01 風格，可搜尋、點擊閱讀 Markdown 全文
- 🌐 GitHub Pages 靜態部署支援

---

## 💾 資料儲存路徑

所有剪輯下來的內容都儲存在本機硬碟上，路徑如下：

```
/home/koto/公共/House_Loan/Clips/
└── YYYY/                        ← 年份
    └── MM/                      ← 月份
        └── DD-slug/             ← 日期 + 文章 Slug（自動產生）
            ├── index.md         ← 文章主文（Markdown + YAML Frontmatter）
            └── assets/          ← 下載的圖片
                ├── img_0.jpg
                ├── img_1.png
                └── ...
```

**範例路徑：**
```
/home/koto/公共/House_Loan/Clips/2026/04/20-my-article/
├── index.md
└── assets/
    └── img_0.jpg
```

> RxDB 索引資料（記錄標題、連結、建立時間）會另外儲存在：
> `/home/koto/公共/House_Loan/rxdb_data.json`

---

## 🚀 啟動方式

### 安裝依賴

```bash
cd /home/koto/公共/House_Loan
npm install
```

### 啟動 Knowledge Hub 後端

```bash
npm start
```

伺服器啟動於 `http://127.0.0.1:44123`

| 路徑 | 說明 |
|------|------|
| `http://127.0.0.1:44123/` | 首頁入口 |
| `http://127.0.0.1:44123/forum.html` | Social Wall 論壇介面 |
| `POST /api/clip` | Clipper 傳送資料的 API |
| `GET /api/clips` | 取得所有剪輯清單（JSON）|
| `DELETE /api/clips/:id` | 刪除指定剪輯（同步刪除硬碟檔案）|

---

## 🎯 Chrome Clipper 使用方式

Clipper 擴充功能位於 `house-loan-clipper/` 目錄。

### 安裝步驟

1. 開啟 Chrome → 網址列輸入 `chrome://extensions/`
2. 開啟右上角「開發人員模式」
3. 點「載入未封裝項目」→ 選擇 `/home/koto/公共/House_Loan/house-loan-clipper/`

### 兩種剪輯模式

| 模式 | 說明 |
|------|------|
| **🎯 選取區塊** | 點擊啟動後，在頁面上滑鼠點擊想要的區塊（紅框 hover，藍框選取），可多選，再點「✅ 確認並剪輯」 |
| **📄 整頁自動提取** | 自動尋找頁面的 `<article>` / `<main>` 等主要內容區塊，過濾掉 JS/CSS/廣告，一鍵儲存 |

兩種模式都會：
- 過濾掉 `<script>/<style>/base64/SVG` 等雜訊
- 自動下載圖片到 `assets/` 資料夾
- 把 HTML 轉成乾淨的 Markdown 存檔

---

## 📰 Social Wall 論壇介面

開啟 `http://127.0.0.1:44123/forum.html`：

- **左欄**：所有文章清單（類 Mobile01 Thread List），含縮圖、來源網域、相對時間
- **右側欄**：文章統計（總數 / 本月 / 今日）+ 最近收藏
- **搜尋欄**：即時過濾標題
- **閱讀器**：點擊文章後在同頁彈出 Modal，完整渲染 Markdown 全文 + 本地圖片

---

## 📁 完整檔案結構

```
House_Loan/
├── main.js                    # Knowledge Hub 後端 (Express + RxDB)
├── index.html                 # 首頁入口
├── forum.html                 # Social Wall 論壇介面（Mobile01 風格）
├── package.json
├── rxdb_data.json             # RxDB 自動產生的持久化索引（可刪除重建）
├── README.md
├── ROADMAP.md
│
├── Clips/                     # 📁 所有剪輯內容儲存於此
│   └── YYYY/MM/DD-slug/
│       ├── index.md           # 文章主文
│       └── assets/            # 下載的圖片
│
├── house-loan-clipper/        # Chrome 擴充功能
│   ├── manifest.json
│   ├── popup.html             # 擴充功能彈窗
│   ├── popup.js               # 彈窗邏輯（選取 + 傳送）
│   └── content-script.js     # 注入到頁面的視覺框選 UI
│
└── .github/
    └── workflows/
        └── deploy.yml         # GitHub Pages 自動部署
```

---

## 🧮 房貸計算公式

### 本息均攤（等額還款）

```
月付金額 = P × r / (1 - (1 + r)^(-n))

P = 貸款本金
r = 月利率（年利率 ÷ 12）
n = 還款月數（年限 × 12）
```

### 本金均攤（等本還款）

```
月還本金 = P / n
月付利息 = 剩餘本金 × r
月付金額 = 月還本金 + 月付利息
```

---

## ⚠️ 免責聲明

本計算器結果僅供參考，實際貸款條件（利率、手續費等）請以銀行公告為準。
