#!/bin/bash
# Remove Honoka Bridge Launch Agent

PLIST_NAME="com.honoka.bridge"
PLIST_FILE="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

echo "Stopping Honoka Bridge..."
launchctl bootout "gui/$(id -u)/$PLIST_NAME" 2>/dev/null || true
rm -f "$PLIST_FILE"
echo "Done. Bridge uninstalled."
