#!/usr/bin/env zsh
# Pull the cloud-managed recovery/hunter.db and merge new rows into the local powerpage.db.
# Idempotent — re-running is a no-op if nothing new arrived.
#
# Usage:
#   bin/hunter-merge-local.sh           # pull, merge, print summary
#   bin/hunter-merge-local.sh --dry-run # show what would change, don't write

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

DRY_RUN=""
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

echo "→ git pull (recovery/hunter.db is updated by GitHub Actions)"
git pull --rebase --autostash

if [[ ! -f recovery/hunter.db ]]; then
  echo "✗ recovery/hunter.db missing — has the workflow run yet?"
  exit 1
fi

REMOTE_CAND=$(sqlite3 recovery/hunter.db "SELECT COUNT(*) FROM peq_recovery_candidates;")
REMOTE_REC=$( sqlite3 recovery/hunter.db "SELECT COUNT(*) FROM peq_posts_recovered;")
LOCAL_CAND=$( sqlite3 powerpage.db     "SELECT COUNT(*) FROM peq_recovery_candidates;")
LOCAL_REC=$(  sqlite3 powerpage.db     "SELECT COUNT(*) FROM peq_posts_recovered;")

echo
echo "cloud:  candidates=$REMOTE_CAND  recovered=$REMOTE_REC"
echo "local:  candidates=$LOCAL_CAND  recovered=$LOCAL_REC"

if [[ -n "$DRY_RUN" ]]; then
  sqlite3 powerpage.db <<SQL
ATTACH DATABASE 'recovery/hunter.db' AS cloud;
SELECT 'new candidates:', COUNT(*)
  FROM cloud.peq_recovery_candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM peq_recovery_candidates l
    WHERE l.original_url = c.original_url AND l.cdx_timestamp = c.cdx_timestamp
  );
SELECT 'new recovered:', COUNT(*)
  FROM cloud.peq_posts_recovered c
  WHERE NOT EXISTS (
    SELECT 1 FROM peq_posts_recovered l
    WHERE l.source_original_url = c.source_original_url
      AND l.source_snapshot_ts  = c.source_snapshot_ts
  );
DETACH DATABASE cloud;
SQL
  exit 0
fi

# Real merge: upsert candidates (matches local UNIQUE(original_url, cdx_timestamp)),
# insert new recovered rows by (source_original_url, source_snapshot_ts).
sqlite3 powerpage.db <<SQL
ATTACH DATABASE 'recovery/hunter.db' AS cloud;
BEGIN;

# Import newly discovered candidates as 'pending' locally — do NOT inherit the cloud's
# 'fetched' status. The cloud fetches metadata only (--no-body); the local daemon
# (hunter-local-recover.sh) is the source of article BODIES, so every candidate must
# stay fetchable locally even if the cloud already grabbed its metadata. Inheriting
# 'fetched' here is what previously starved the body-fetcher.
INSERT OR IGNORE INTO peq_recovery_candidates
  (original_url, cdx_timestamp, inferred_date, confidence, hint, digest, status, fail_reason)
SELECT original_url, cdx_timestamp, inferred_date, confidence, hint, digest, 'pending', NULL
FROM cloud.peq_recovery_candidates;

INSERT INTO peq_posts_recovered
  (candidate_id, proposed_post_date, proposed_post_title, proposed_post_content,
   proposed_post_author, source, source_url, source_original_url, source_snapshot_ts,
   confidence, reviewed, reviewer_notes, created_at)
SELECT NULL, proposed_post_date, proposed_post_title, proposed_post_content,
       proposed_post_author, source, source_url, source_original_url, source_snapshot_ts,
       confidence, reviewed, reviewer_notes, created_at
FROM cloud.peq_posts_recovered c
WHERE NOT EXISTS (
  SELECT 1 FROM peq_posts_recovered l
  WHERE l.source_original_url = c.source_original_url
    AND l.source_snapshot_ts  = c.source_snapshot_ts
);

COMMIT;
DETACH DATABASE cloud;
SQL

NEW_LOCAL_CAND=$(sqlite3 powerpage.db "SELECT COUNT(*) FROM peq_recovery_candidates;")
NEW_LOCAL_REC=$( sqlite3 powerpage.db "SELECT COUNT(*) FROM peq_posts_recovered;")

echo
echo "✓ Merged: candidates $LOCAL_CAND → $NEW_LOCAL_CAND  recovered $LOCAL_REC → $NEW_LOCAL_REC"
echo
echo "Reload powerpage.db in pp-twin's Hunter tab to see the new entries."
