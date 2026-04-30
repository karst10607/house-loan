#!/bin/bash
set -e

echo "正在安裝與更新 Honoka Chrome Extension 與 Bridge 伺服器..."

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="$BASE_DIR/honoka-bridge"
NODE_PATH="$(which node)"

if [ -z "$NODE_PATH" ]; then
    echo "[錯誤] 找不到 Node.js！請先安裝 Node.js。"
    exit 1
fi

# ======== 1. 安裝 Honoka Bridge 伺服器 ========
echo "[1/2] 設定 Honoka Bridge 背景執行..."

SERVICE_NAME="honoka-bridge"
SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
LOG_DIR="$HOME/.local/state/honoka-bridge"

mkdir -p "$LOG_DIR"
mkdir -p "$HOME/.config/systemd/user"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Honoka Bridge - Local Doc Server
After=network.target

[Service]
Type=simple
ExecStart=$NODE_PATH $BRIDGE_DIR/index.js
Restart=always
Environment=HONOKA_PORT=44124
Environment=HONOKA_EDITOR=cursor
StandardOutput=append:$LOG_DIR/stdout.log
StandardError=append:$LOG_DIR/stderr.log

[Install]
WantedBy=default.target
EOF

# systemctl --user daemon-reload
# systemctl --user enable "$SERVICE_NAME" >/dev/null 2>&1
# systemctl --user restart "$SERVICE_NAME"

echo "  ℹ Bridge 背景服務已停用 (改為手動啟動)。"
echo "  ℹ 手動啟動指令: cd $BRIDGE_DIR && npm start"

# sleep 1
# if curl -s http://127.0.0.1:44124/status > /dev/null 2>&1; then
#   echo "  ✓ Bridge 成功運行於 http://127.0.0.1:44124"
# else
#   echo "  ⚠ Bridge 啟動可能有問題，請檢查日誌: cat $LOG_DIR/stderr.log"
# fi

# ======== 2. 安裝 Chrome 擴充功能 ========
echo "[2/2] 登錄 Chrome 擴充功能..."

EXT_ID="pmcgaidpdpelalcjmagljeemgklhooog"
CRX_NAME="honoka.crx"
CRX_VERSION="0.48.7"
CRX_PATH="$BASE_DIR/$CRX_NAME"

if [ -f "$CRX_PATH" ]; then
    CHROME_EXT_DIR="/opt/google/chrome/extensions"
    JSON_FILE="$CHROME_EXT_DIR/$EXT_ID.json"
    
    echo "  系統可能會要求 sudo 權限來寫入 Chrome 設定目錄 ($CHROME_EXT_DIR)..."
    sudo mkdir -p "$CHROME_EXT_DIR"
    
    sudo tee "$JSON_FILE" > /dev/null <<EOF
{
  "external_crx": "$CRX_PATH",
  "external_version": "$CRX_VERSION"
}
EOF
    
    # 支援 Chromium
    CHROMIUM_EXT_DIR="/usr/share/chromium/extensions"
    sudo mkdir -p "$CHROMIUM_EXT_DIR"
    sudo cp "$JSON_FILE" "$CHROMIUM_EXT_DIR/"
    
    echo "  ✓ 擴充功能已成功登錄。"
else
    echo "  [警告] 找不到 $CRX_NAME，請確認你已經將擴充功能打包為 $CRX_NAME 並放在同一個資料夾下。"
    echo "  (擴充功能註冊已略過，但 Bridge 伺服器已正常啟動)"
fi

echo ""
echo "=============================================="
echo "安裝完成！"
echo "1. Bridge 伺服器改為手動啟動：cd $BRIDGE_DIR && npm start"
echo "2. 請重新啟動 Google Chrome / Chromium 瀏覽器。"
echo "=============================================="
