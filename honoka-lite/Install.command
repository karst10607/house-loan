#!/bin/bash
# Honoka — Double-click installer.
#
# This file's location becomes the PERMANENT install location for the
# Bridge LaunchAgent (its plist hardcodes the absolute path of
# honoka-bridge/index.js). Move/rename this folder after install and
# the Bridge will fail to start on next login.
#
# If you DO move it later: just double-click this file again from the
# new location to update the LaunchAgent.

cd "$(dirname "$0")" || exit 1

clear
cat <<'BANNER'

  ╔═══════════════════════════════════════════════════════╗
  ║                                                       ║
  ║   Honoka — Installer                                  ║
  ║                                                       ║
  ║   This will install:                                  ║
  ║     • Node.js v18+ (if you don't have it)             ║
  ║     • Honoka Bridge (background service)              ║
  ║     • Open your browser's extensions page             ║
  ║                                                       ║
  ║   You may be asked for your Mac password (for         ║
  ║   installing Node.js — Apple's standard prompt).      ║
  ║                                                       ║
  ╚═══════════════════════════════════════════════════════╝

BANNER

echo "  Install location: $(pwd)"
echo "  ⚠ Don't move this folder after install — the Bridge"
echo "    remembers this exact path. (To move: re-run me from"
echo "    the new location.)"
echo ""
read -r -p "  Press Enter to start, or Ctrl-C to cancel..." _

bash setup.sh
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "  ✓ Done! You can close this window now."
else
  echo "  ✗ Install hit an error (exit code $EXIT_CODE)."
  echo "    See the README.md 'Troubleshooting' section."
fi
echo ""
read -r -p "  Press Enter to close..." _
