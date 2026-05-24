#!/usr/bin/env bash
# Install or reinstall the pp-twin daily sync LaunchAgent.
# Usage:
#   bin/install-launchd.sh           # install + load
#   bin/install-launchd.sh uninstall # unload + remove

set -euo pipefail

LABEL="ai.ogrady.pptwin-sync"
SRC_PLIST="$(cd "$(dirname "$0")" && pwd)/$LABEL.plist"
DEST_PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

case "${1:-install}" in
  install)
    [ -f "$SRC_PLIST" ] || { echo "missing $SRC_PLIST"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents"
    # bootout first in case it was loaded; ignore failure
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    cp "$SRC_PLIST" "$DEST_PLIST"
    launchctl bootstrap "gui/$UID" "$DEST_PLIST"
    launchctl enable   "gui/$UID/$LABEL"
    echo "installed: $DEST_PLIST"
    launchctl print "gui/$UID/$LABEL" | grep -E 'state|next' | head -5 || true
    ;;
  uninstall)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    rm -f "$DEST_PLIST"
    echo "uninstalled $LABEL"
    ;;
  status)
    launchctl print "gui/$UID/$LABEL" 2>/dev/null | head -30 || echo "not loaded"
    ;;
  run-now)
    launchctl kickstart -k "gui/$UID/$LABEL"
    echo "triggered $LABEL"
    ;;
  *)
    echo "usage: $0 [install|uninstall|status|run-now]"; exit 2;;
esac
