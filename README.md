# 房貸計算器 🏠

一個輕量、跨平台的房貸計算器，支援 **本息均攤** 與 **本金均攤** 兩種還款方式，並附完整攤還明細表。

同時支援 **GitHub Pages 網頁版** 與 **🍐 Pear P2P 桌面版**。

[![Deploy to GitHub Pages](https://github.com/YOUR_USERNAME/House_Loan/actions/workflows/deploy.yml/badge.svg)](https://github.com/YOUR_USERNAME/House_Loan/actions/workflows/deploy.yml)

## ✨ 功能

- 🔢 輸入貸款金額、年利率、年限
- 📊 顯示月付金額、總利息、總還款金額
- 📈 本金 vs 利息比例視覺化
- 📋 完整逐月攤還明細表
- 📱 響應式設計，手機、平板、電腦皆可使用
- 🌐 純靜態網頁，可部署至 GitHub Pages
- 🍐 支援 Pear P2P Runtime，去中心化分享

## 🚀 部署到 GitHub Pages

### 方法一：GitHub Actions（建議）

1. 將此專案 push 到 GitHub repository
2. 進入 repository → **Settings** → **Pages**
3. 將 **Source** 設為 **GitHub Actions**
4. 任何推送到 `main` 分支都會自動部署

### 方法二：手動部署

1. 進入 repository → **Settings** → **Pages**
2. 將 **Source** 設為 **Deploy from a branch**
3. 選擇 `main` 分支，目錄選 `/ (root)`
4. 儲存後等待幾分鐘即可

## 🍐 Pear P2P 模式

此專案同時支援 [Pear Runtime](https://docs.pears.com)，讓你可以透過 P2P 網路分享應用，不需要任何伺服器。

### 安裝 Pear Runtime

```bash
npx pear
```

依照指示設定 `PATH` 環境變數。

### 開發模式（本地執行）

```bash
pear run .
```

### 發佈到 P2P 網路

```bash
# 暫存應用
pear stage .

# 發佈，取得 pear:// 連結
pear release .
```

分享取得的 `pear://` 連結，其他安裝了 Pear 的使用者可以直接執行：

```bash
pear run pear://<your-key>
```

## 🧮 計算公式

### 本息均攤（等額還款）

每月還款金額固定：

```
月付金額 = P × r / (1 - (1 + r)^(-n))

P = 貸款本金
r = 月利率（年利率 ÷ 12）
n = 還款月數（年限 × 12）
```

### 本金均攤（等本還款）

每月還款本金固定，利息逐月遞減：

```
月還本金 = P / n
月付利息 = 剩餘本金 × r
月付金額 = 月還本金 + 月付利息
```

## 📁 檔案結構

```
House_Loan/
├── index.html          # 主頁面（Pear + Web 共用）
├── style.css           # 樣式
├── calculator.js       # 計算邏輯
├── package.json        # Pear Runtime 配置
├── README.md
└── .github/
    └── workflows/
        └── deploy.yml  # GitHub Pages 自動部署
```

## ⚠️ 免責聲明

本計算器結果僅供參考，實際貸款條件（利率、手續費等）請以銀行公告為準。

