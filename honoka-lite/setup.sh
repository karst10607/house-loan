#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# Honoka — One-Click Setup (macOS)
#
# Installs everything needed to run Honoka Chrome Extension + Bridge:
#   1. Node.js (if not installed)
#   2. Honoka Bridge as a macOS Launch Agent (auto-starts on login)
#   3. Opens the browser extensions page so you can Load unpacked
#
# Usage:
#   git clone git@github.com:kouzoh/c2n-dualplay.git
#   cd c2n-dualplay
#   bash setup.sh
#
# No prior setup required — works on a fresh macOS machine.
# ─────────────────────────────────────────────────────────────────────

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="$REPO_DIR/honoka-bridge"
EXT_DIR="$REPO_DIR/chrome-extension"
MIN_NODE_MAJOR=18

echo ""
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║  Honoka — One-Click Setup                     ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo ""

# ─── Step 1: Ensure Node.js is installed ──────────────────────────

# Refresh PATH so a freshly installed `node` is visible to this script,
# regardless of whether it landed in /opt/homebrew/bin (Apple Silicon brew),
# /usr/local/bin (Intel brew or nodejs.org .pkg), or /usr/bin.
refresh_node_path() {
  for dir in /opt/homebrew/bin /usr/local/bin /usr/bin; do
    if [ -x "$dir/node" ] && [[ ":$PATH:" != *":$dir:"* ]]; then
      export PATH="$dir:$PATH"
    fi
  done
  hash -r 2>/dev/null || true
}

# Detect whether the current `node` is managed by a version manager (nvm, asdf,
# volta, fnm, n). In that case `brew install node` won't change which node the
# user actually runs — we have to ask them to upgrade through their manager.
detect_node_manager() {
  local node_path
  node_path=$(command -v node 2>/dev/null || true)
  case "$node_path" in
    *"/.nvm/"*)    echo "nvm"; return ;;
    *"/.asdf/"*)   echo "asdf"; return ;;
    *"/.volta/"*)  echo "volta"; return ;;
    *"/.fnm/"*|*"/fnm_multishells/"*) echo "fnm"; return ;;
    *"/n/versions/"*) echo "n"; return ;;
  esac
  if [ -n "${NVM_DIR:-}" ] && [ -n "$node_path" ] && [[ "$node_path" == "$NVM_DIR/"* ]]; then
    echo "nvm"; return
  fi
  echo ""
}

install_node_with_pkg() {
  echo "  Downloading Node.js installer from nodejs.org..."
  local NODE_VERSION="22.14.0"
  local PKG_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}.pkg"
  local PKG_FILE="/tmp/node-v${NODE_VERSION}.pkg"

  curl -fsSL "$PKG_URL" -o "$PKG_FILE"
  echo ""
  echo "  Opening Node.js installer (this will overwrite any existing /usr/local/bin/node)..."
  echo "  (Follow the installer prompts, then come back here)"
  echo ""
  sudo installer -pkg "$PKG_FILE" -target /
  rm -f "$PKG_FILE"
}

install_node() {
  local current_ver="$1"  # empty string if node not installed
  local manager
  manager=$(detect_node_manager)

  if [ -n "$manager" ]; then
    echo ""
    echo "  ✗ Detected Node.js managed by '$manager' (current: v${current_ver})."
    echo "    setup.sh won't override a version manager. Please upgrade yourself:"
    case "$manager" in
      nvm)   echo "        nvm install ${MIN_NODE_MAJOR} && nvm alias default ${MIN_NODE_MAJOR}" ;;
      asdf)  echo "        asdf install nodejs latest && asdf global nodejs latest" ;;
      volta) echo "        volta install node@${MIN_NODE_MAJOR}" ;;
      fnm)   echo "        fnm install ${MIN_NODE_MAJOR} && fnm default ${MIN_NODE_MAJOR}" ;;
      n)     echo "        n ${MIN_NODE_MAJOR}" ;;
    esac
    echo "    Then re-run: bash setup.sh"
    echo ""
    echo "    (Or, easiest fallback: download the macOS LTS installer from"
    echo "     https://nodejs.org/, run it, then re-run: bash setup.sh)"
    exit 1
  fi

  if [ -n "$current_ver" ]; then
    local node_path
    node_path=$(command -v node 2>/dev/null || true)
    echo "  Detected old Node.js v${current_ver} at ${node_path}."
    echo "  Will upgrade in-place to v${MIN_NODE_MAJOR}+..."
  else
    echo "  Node.js not found. Installing v${MIN_NODE_MAJOR}+..."
  fi
  echo ""

  # Decision: prefer brew ONLY when brew already manages node (avoids stepping
  # on brew's symlinks on Intel, where /usr/local/bin is shared with .pkg).
  # Otherwise always use the official .pkg installer — predictable, overwrites
  # cleanly, no PATH gotchas, no dependency on Homebrew being installed.
  if command -v brew &>/dev/null && brew list --formula node &>/dev/null; then
    echo "  Existing Homebrew node detected — upgrading via 'brew upgrade node'..."
    brew upgrade node || true
  else
    echo "  Using the official Node.js .pkg installer from nodejs.org."
    echo "  (You may be prompted for your Mac password — sudo is required to"
    echo "   write to /usr/local/bin.)"
    echo ""
    install_node_with_pkg
  fi

  refresh_node_path
}

check_node() {
  if ! command -v node &>/dev/null; then
    NODE_CURRENT_VER=""
    return 1
  fi
  local ver
  ver=$(node --version 2>/dev/null | sed 's/v//')
  NODE_CURRENT_VER="$ver"
  local major
  major=$(echo "$ver" | cut -d. -f1)
  if [ "$major" -lt "$MIN_NODE_MAJOR" ] 2>/dev/null; then
    echo "  ⚠ Node.js v${ver} found but v${MIN_NODE_MAJOR}+ is required."
    return 1
  fi
  return 0
}

NODE_CURRENT_VER=""
if check_node; then
  echo "  ✓ Node.js $(node --version) found"
else
  install_node "$NODE_CURRENT_VER"
  if check_node; then
    echo "  ✓ Node.js $(node --version) installed successfully"
  else
    echo ""
    echo "  ✗ Failed to install/upgrade Node.js automatically."
    echo "    Easiest fix: download the macOS LTS installer (.pkg) from"
    echo "      https://nodejs.org/"
    echo "    run it, then re-run: bash setup.sh"
    exit 1
  fi
fi
echo ""

# ─── Step 2: Verify extension build exists ────────────────────────

if [ ! -f "$EXT_DIR/dist/content.js" ]; then
  echo "  ⚠ dist/content.js not found — rebuilding..."
  cd "$REPO_DIR"
  npm install
  npm run ext:build
  echo "  ✓ Extension built"
else
  echo "  ✓ Extension pre-built (dist/content.js exists)"
fi
echo ""

# ─── Step 3: Install Bridge as Launch Agent ───────────────────────

echo "  Installing Honoka Bridge (auto-start on login)..."
bash "$BRIDGE_DIR/install.sh"

# ─── Step 4: Open browser extensions page ─────────────────────────

echo ""
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "  │                                                          │"
echo "  │  Almost done! One manual step remaining:                 │"
echo "  │                                                          │"
echo "  │  1. Your browser's extensions page is opening now...     │"
echo "  │  2. Enable 'Developer mode' (top-right toggle)           │"
echo "  │  3. Click 'Load unpacked'                                │"
echo "  │  4. Select this folder:                                  │"
echo "  │                                                          │"
echo "  │     $EXT_DIR"
echo "  │                                                          │"
echo "  │  5. Open any Notion page — the overlay should appear!    │"
echo "  │                                                          │"
echo "  └──────────────────────────────────────────────────────────┘"
echo ""

# Try to detect which browser to open
if [ -d "/Applications/Google Chrome.app" ]; then
  open "chrome://extensions"
elif [ -d "/Applications/Vivaldi.app" ]; then
  open "vivaldi://extensions"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open "microsoft-edge://extensions"
elif [ -d "/Applications/Brave Browser.app" ]; then
  open "brave://extensions"
elif [ -d "/Applications/Arc.app" ]; then
  open "chrome://extensions"
else
  echo "  (Could not detect browser — open chrome://extensions manually)"
fi

echo "  Setup complete! 🎉"
echo ""
