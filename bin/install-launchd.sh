#!/usr/bin/env bash
# Install or reinstall a pp-twin LaunchAgent.
#
# Two agents ship with this repo:
#   sync    (ai.ogrady.pptwin-sync)    — daily Bluehost → powerpage.db sync (3:30am)
#   recover (ai.ogrady.pptwin-recover) — persistent local body-fetch daemon (Mac mini)
#
# Usage:
#   bin/install-launchd.sh [action] [agent]
#     action: install (default) | uninstall | status | run-now
#     agent:  sync (default) | recover
#
# Examples:
#   bin/install-launchd.sh install recover    # start the recovery daemon on the Mac mini
#   bin/install-launchd.sh status  recover
#   bin/install-launchd.sh uninstall recover

set -euo pipefail

case "${2:-sync}" in
  sync)    LABEL="ai.ogrady.pptwin-sync" ;;
  recover) LABEL="ai.ogrady.pptwin-recover" ;;
  *) echo "unknown agent '${2}' (use: sync | recover)"; exit 2 ;;
esac
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
    echo "usage: $0 [install|uninstall|status|run-now] [sync|recover]"; exit 2;;
esac
