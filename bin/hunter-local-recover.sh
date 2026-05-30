#!/usr/bin/env bash
# Persistent LOCAL body-fetch daemon for the Hunter recovery pipeline.
#
# The cloud cron (GitHub Actions, every 2h) discovers candidates and fetches
# metadata only (--no-body). This daemon is the local counterpart that fetches
# the actual article BODIES into powerpage.db — the 1.2 GB local-only store that
# is never committed. It is meant to run forever on the Mac mini (via launchd),
# draining the pending queue politely so it survives reboots and Wayback throttling.
#
# Why a drip, not one big run: web.archive.org's playback host TCP-refuses us
# after ~35 requests in a burst (it is far stricter than the CDX/availability
# API). So we fetch a small batch, then cool down for several minutes. Average
# request rate stays low enough to avoid the block, and progress is durable —
# every fetched candidate is marked 'fetched' in powerpage.db, so a kill/reboot
# just resumes where it left off.
#
# Priority: gap years first (2008 is the catastrophic hole — 2 live posts), then
# the other candidate-heavy years, then a catch-all that mops up everything else
# including the pre-2002 / year-2000 candidates that have no inferred date.
#
# Usage:
#   bin/hunter-local-recover.sh                  # run the daemon (loops forever)
#   bin/hunter-local-recover.sh --once           # one batch then exit (for testing)
#   bin/hunter-local-recover.sh --status         # print queue progress and exit
#   bin/hunter-local-recover.sh --requeue-bodyless  # reset fetched-but-bodyless candidates
#                                                # back to pending (undo cloud no-body imports)
#
# Tunables (env vars, with defaults):
#   PP_BATCH=20       candidates per batch
#   PP_DELAY=4        seconds between requests within a batch
#   PP_COOLDOWN=360   seconds to sleep between batches (dodge the throttle)
#   PP_MIN_CONF=0.7   minimum candidate confidence to fetch

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

PYTHON="$PROJECT_DIR/.venv/bin/python"
DB="$PROJECT_DIR/powerpage.db"
RECOVER="$PROJECT_DIR/bin/wayback-recover.py"

BATCH="${PP_BATCH:-20}"
DELAY="${PP_DELAY:-4}"
COOLDOWN="${PP_COOLDOWN:-360}"
MIN_CONF="${PP_MIN_CONF:-0.7}"

# Highest-value windows first; the empty "global" sentinel at the end is the
# catch-all pass (no date filter) that also reaches NULL-inferred-date candidates.
PRIORITY_WINDOWS=( "2008 2009" "2007 2008" "2006 2007" "2005 2006" "2004 2005" "2003 2004" "global" )

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

require() {
  [ -x "$PYTHON" ]  || { log "FATAL: venv python missing at $PYTHON — create it (see HANDOFF.md)"; exit 1; }
  [ -f "$DB" ]      || { log "FATAL: $DB missing — sync it first (bin/sync-from-bluehost.sh) or wait for iCloud"; exit 1; }
  [ -f "$RECOVER" ] || { log "FATAL: $RECOVER missing"; exit 1; }
  command -v sqlite3 >/dev/null || { log "FATAL: sqlite3 not on PATH"; exit 1; }
}

pending_count() {  # $1,$2 = since,until ; or no args = total pending
  if [ "$#" -eq 2 ]; then
    sqlite3 "$DB" "SELECT COUNT(*) FROM peq_recovery_candidates WHERE status='pending' AND confidence>=$MIN_CONF AND inferred_date>='$1' AND inferred_date<'$2';"
  else
    sqlite3 "$DB" "SELECT COUNT(*) FROM peq_recovery_candidates WHERE status='pending' AND confidence>=$MIN_CONF;"
  fi
}

# The cloud cron fetches metadata only (--no-body); hunter-merge-local.sh used to
# import those rows and mark the candidates 'fetched' locally, which would starve
# the local body-fetcher. This resets any candidate whose recovered row has no real
# body back to 'pending' and drops the empty rows, so the daemon refetches bodies.
requeue_bodyless() {
  local before after
  before="$(pending_count)"
  sqlite3 "$DB" <<'SQL'
BEGIN;
DELETE FROM peq_posts_recovered WHERE length(coalesce(proposed_post_content,'')) < 200;
UPDATE peq_recovery_candidates SET status='pending'
WHERE status='fetched'
  AND NOT EXISTS (
    SELECT 1 FROM peq_posts_recovered r
    WHERE r.source_original_url = peq_recovery_candidates.original_url
      AND r.source_snapshot_ts  = peq_recovery_candidates.cdx_timestamp
  );
COMMIT;
SQL
  after="$(pending_count)"
  log "requeue-bodyless: pending $before → $after (bodyless recovered rows dropped, candidates reset)"
}

print_status() {
  log "queue status:"
  sqlite3 -header -column "$DB" "SELECT status, COUNT(*) FROM peq_recovery_candidates GROUP BY status;"
  sqlite3 -header -column "$DB" "SELECT substr(proposed_post_date,1,4) yr, COUNT(*) recovered, SUM(length(coalesce(proposed_post_content,''))>500) with_body FROM peq_posts_recovered GROUP BY yr ORDER BY yr;"
}

# Fetch one batch from the highest-priority window that still has pending work.
# Returns 0 if it ran a batch, 1 if nothing is left to do anywhere.
run_one_batch() {
  for win in "${PRIORITY_WINDOWS[@]}"; do
    if [ "$win" = "global" ]; then
      local n; n="$(pending_count)"
      [ "${n:-0}" -gt 0 ] || return 1   # nothing pending anywhere → done
      log "batch: catch-all (global) · $n pending · limit=$BATCH delay=${DELAY}s"
      "$PYTHON" -u "$RECOVER" fetch --limit "$BATCH" --delay "$DELAY" --min-confidence "$MIN_CONF"
      return 0
    fi
    # shellcheck disable=SC2086
    local since until n
    since="${win% *}"; until="${win#* }"
    n="$(pending_count "$since" "$until")"
    if [ "${n:-0}" -gt 0 ]; then
      log "batch: ${since}–${until} · $n pending in window · limit=$BATCH delay=${DELAY}s"
      "$PYTHON" -u "$RECOVER" fetch --since "$since" --until "$until" --limit "$BATCH" --delay "$DELAY" --min-confidence "$MIN_CONF"
      return 0
    fi
  done
  return 1
}

case "${1:-}" in
  --status)          require; print_status; exit 0 ;;
  --once)            require; run_one_batch; exit 0 ;;
  --requeue-bodyless) require; requeue_bodyless; exit 0 ;;
  "")                : ;;  # daemon mode, below
  *) echo "usage: $0 [--once|--status|--requeue-bodyless]"; exit 2 ;;
esac

require
log "hunter-local-recover starting · batch=$BATCH delay=${DELAY}s cooldown=${COOLDOWN}s min_conf=$MIN_CONF"
requeue_bodyless   # self-heal: pick up any cloud no-body imports that slipped in
idle_cycles=0
while true; do
  if run_one_batch; then
    idle_cycles=0
    sleep "$COOLDOWN"
  else
    # Queue is fully drained. The cloud cron keeps discovering, so stay alive and
    # re-check on a slow cadence rather than exiting (launchd would just relaunch).
    idle_cycles=$((idle_cycles + 1))
    [ "$idle_cycles" -eq 1 ] && log "queue drained — nothing pending. Idling; will re-check hourly for new cloud candidates."
    sleep 3600
  fi
done
