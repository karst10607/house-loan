#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# Honoka Bridge — Install as macOS Launch Agent
#
# What this does:
#   1. Removes macOS quarantine flags so Gatekeeper won't block it
#   2. Creates a Launch Agent plist (auto-starts on login)
#   3. Starts the bridge immediately
#
# The bridge is a plain Node.js script (index.js) that listens on
# localhost:7749. It writes files to ~/honoka-docs/. It does NOT
# access the network, send telemetry, or require elevated privileges.
#
# Source: https://github.com/kouzoh/c2n-dualplay/tree/main/honoka-bridge
# ─────────────────────────────────────────────────────────────────────

set -e

BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_PATH="$(which node)"
PLIST_NAME="com.honoka.bridge"
PLIST_FILE="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$HOME/Library/Logs/honoka-bridge"

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║  Honoka Bridge — Local Doc Server     ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""
echo "  This installs a background service that lets the Honoka"
echo "  Chrome extension save Notion pages as local .md files."
echo ""
echo "  What it does:"
echo "    • Listens on localhost:7749 (local only, no internet)"
echo "    • Writes docs to ~/honoka-docs/"
echo "    • Opens files in Cursor / VS Code"
echo ""
echo "  Bridge:  $BRIDGE_DIR/index.js"
echo "  Node:    $NODE_PATH"
echo "  Logs:    $LOG_DIR/"
echo ""

mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

# Remove macOS quarantine flags (prevents "unidentified developer" warning)
echo "  Removing quarantine flags..."
xattr -dr com.apple.quarantine "$BRIDGE_DIR" 2>/dev/null || true
xattr -dr com.apple.quarantine "$NODE_PATH" 2>/dev/null || true

# Unload existing agent if present
launchctl bootout "gui/$(id -u)/$PLIST_NAME" 2>/dev/null || true

cat > "$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${BRIDGE_DIR}/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HONOKA_PORT</key>
        <string>7749</string>
        <key>HONOKA_EDITOR</key>
        <string>cursor</string>
    </dict>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"

# Verify it started
sleep 1
if curl -s http://127.0.0.1:7749/status > /dev/null 2>&1; then
  echo "  ✓ Bridge is running on http://127.0.0.1:7749"
else
  echo "  ⚠ Bridge may still be starting. Check logs:"
  echo "    tail -f $LOG_DIR/stderr.log"
fi

echo ""
echo "  Done! The bridge will auto-start on every login."
echo ""
echo "  ┌──────────────────────────────────────────────────┐"
echo "  │  Manage:                                         │"
echo "  │    Status:    curl localhost:7749/status          │"
echo "  │    Logs:      tail -f ~/Library/Logs/             │"
echo "  │               honoka-bridge/stdout.log            │"
echo "  │    Uninstall: bash honoka-bridge/uninstall.sh     │"
echo "  └──────────────────────────────────────────────────┘"
echo ""
