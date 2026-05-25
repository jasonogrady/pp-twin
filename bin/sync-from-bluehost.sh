#!/usr/bin/env bash
# pp-twin daily sync from Bluehost
#
# Streams a fresh wp db export over SSH, converts MySQL -> SQLite, re-applies
# the wp_* aliases and gap views, then atomic-swaps the active powerpage.db.
# Keeps the last 7 daily compressed dumps under backups/.
#
# Run via launchd (~/Library/LaunchAgents/ai.ogrady.pptwin-sync.plist) once daily.
# Manual run: bin/sync-from-bluehost.sh
#
# Required: ssh key id_ed25519_bluehost with passphrase cached in macOS Keychain
#   ssh-add --apple-use-keychain ~/.ssh/id_ed25519_bluehost
# Tools used: ssh, gzip/gunzip, awk, sqlite3, mv. mysql2sqlite is invoked locally.

set -euo pipefail

# --- config ------------------------------------------------------------------
PROJECT_DIR="${PROJECT_DIR:-/Users/jason/Library/Mobile Documents/com~apple~CloudDocs/GitHub/pp-twin}"

# Load .env if present so secrets/host details stay out of git. See .env.example.
if [ -f "$PROJECT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$PROJECT_DIR/.env"; set +a
fi

REMOTE_USER="${REMOTE_USER:?REMOTE_USER not set; create .env from .env.example}"
REMOTE_HOST="${REMOTE_HOST:?REMOTE_HOST not set; create .env from .env.example}"
REMOTE_WP_DIR="${REMOTE_WP_DIR:-public_html}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_bluehost}"
KEEP_DAYS="${KEEP_DAYS:-7}"

# --- paths -------------------------------------------------------------------
cd "$PROJECT_DIR"
DATE=$(date +%Y%m%d)
HHMM=$(date +%H%M)
LIVE_DB="$PROJECT_DIR/powerpage.db"
TMP_DB="$PROJECT_DIR/powerpage.db.tmp"
BACKUP_DIR="$PROJECT_DIR/backups"
DUMP_FILE="$BACKUP_DIR/powerpage-$DATE.sql.gz"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/sync-$DATE.log"
MYSQL2SQLITE="$PROJECT_DIR/mysql2sqlite"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"

# --- logging -----------------------------------------------------------------
exec > >(tee -a "$LOG_FILE") 2>&1
say() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { say "FAILED: $*"; osascript -e "display notification \"pp-twin sync failed: $*\" with title \"pp-twin\"" 2>/dev/null || true; exit 1; }

say "sync start ($DATE $HHMM)"

# --- preflight ---------------------------------------------------------------
[ -f "$SSH_KEY" ]      || fail "missing SSH key at $SSH_KEY"
command -v sqlite3 >/dev/null || fail "sqlite3 not on PATH"
command -v awk     >/dev/null || fail "awk not on PATH"

if [ ! -x "$MYSQL2SQLITE" ]; then
  say "fetching mysql2sqlite"
  curl -fsSL -o "$MYSQL2SQLITE" https://raw.githubusercontent.com/dumblob/mysql2sqlite/master/mysql2sqlite || fail "could not download mysql2sqlite"
  chmod +x "$MYSQL2SQLITE"
fi

# --- dump (streamed over SSH, never lands uncompressed) ----------------------
say "streaming dump from $REMOTE_HOST"
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=20 \
    "$REMOTE_USER@$REMOTE_HOST" \
    "cd ~/$REMOTE_WP_DIR && wp db export - --single-transaction --quick --default-character-set=utf8mb4" \
  | gzip -6 > "$DUMP_FILE.partial" \
  || fail "ssh/dump pipeline returned non-zero"

# verify the gzip stream isn't truncated, and the SQL ends with the mysqldump trailer
gzip -t "$DUMP_FILE.partial" || fail "dump gzip is corrupt"
zcat "$DUMP_FILE.partial" | tail -3 | grep -q "Dump completed" || fail "dump truncated (no 'Dump completed' marker)"
mv "$DUMP_FILE.partial" "$DUMP_FILE"
DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
say "dump captured: $DUMP_FILE ($DUMP_SIZE)"

# --- convert MySQL -> SQLite into a temp file --------------------------------
say "converting to SQLite"
rm -f "$TMP_DB"
zcat "$DUMP_FILE" | "$MYSQL2SQLITE" /dev/stdin | sqlite3 "$TMP_DB" \
  || fail "mysql2sqlite | sqlite3 conversion failed"

# --- detect the WordPress table prefix and rebuild wp_* views ---------------
PREFIX=$(sqlite3 "$TMP_DB" "SELECT REPLACE(name,'posts','') FROM sqlite_master WHERE type='table' AND name LIKE '%\_posts' ESCAPE '\' LIMIT 1;")
[ -n "$PREFIX" ] || fail "could not detect WordPress table prefix in fresh DB"
say "detected WP prefix: $PREFIX"

sqlite3 "$TMP_DB" <<SQL
DROP VIEW IF EXISTS wp_posts;
DROP VIEW IF EXISTS wp_users;
DROP VIEW IF EXISTS wp_terms;
DROP VIEW IF EXISTS wp_term_taxonomy;
DROP VIEW IF EXISTS wp_term_relationships;
DROP VIEW IF EXISTS wp_comments;
CREATE VIEW wp_posts              AS SELECT * FROM ${PREFIX}posts;
CREATE VIEW wp_users              AS SELECT * FROM ${PREFIX}users;
CREATE VIEW wp_terms              AS SELECT * FROM ${PREFIX}terms;
CREATE VIEW wp_term_taxonomy      AS SELECT * FROM ${PREFIX}term_taxonomy;
CREATE VIEW wp_term_relationships AS SELECT * FROM ${PREFIX}term_relationships;
CREATE VIEW wp_comments           AS SELECT * FROM ${PREFIX}comments;
SQL

# --- add indexes mysql2sqlite drops (massive speedup for dashboard queries) -
say "rebuilding indexes"
sqlite3 "$TMP_DB" <<SQL
CREATE INDEX IF NOT EXISTS idx_${PREFIX}term_relationships_object_id ON ${PREFIX}term_relationships(object_id);
CREATE INDEX IF NOT EXISTS idx_${PREFIX}comments_post_approved      ON ${PREFIX}comments(comment_post_ID, comment_approved);
ANALYZE;
SQL

# --- re-apply gap views ------------------------------------------------------
[ -f "$PROJECT_DIR/sql/gap-views.sql" ] && sqlite3 "$TMP_DB" < "$PROJECT_DIR/sql/gap-views.sql"

# --- integrity check before swap --------------------------------------------
POST_COUNT=$(sqlite3 "$TMP_DB" "SELECT COUNT(*) FROM wp_posts WHERE post_status='publish' AND post_type='post';" 2>/dev/null || echo 0)
[ "$POST_COUNT" -gt 1000 ] || fail "sanity check failed: only $POST_COUNT published posts in fresh DB"
say "fresh DB has $POST_COUNT published posts"

# --- atomic swap -------------------------------------------------------------
mv "$TMP_DB" "$LIVE_DB"
say "swapped in fresh powerpage.db"

# --- rotate old dumps --------------------------------------------------------
find "$BACKUP_DIR" -name 'powerpage-*.sql.gz' -mtime "+$KEEP_DAYS" -print -delete | sed 's/^/  rotated: /'
find "$LOG_DIR"    -name 'sync-*.log'         -mtime "+30"         -print -delete | sed 's/^/  rotated: /'

say "sync done"
