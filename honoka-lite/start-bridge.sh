#!/bin/bash
BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)/honoka-bridge"
echo "🚀 正在手動啟動 Honoka Bridge..."
cd "$BRIDGE_DIR"
npm start
