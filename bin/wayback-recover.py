#!/usr/bin/env python3
"""
pp-twin Wayback Machine recovery scraper.

Stages candidate post URLs from archive.org's CDX index into peq_recovery_candidates,
fetches each snapshot, extracts {title, body, author, date}, and inserts into
peq_posts_recovered for human review in pp-twin.

Usage:
    bin/wayback-recover.py enumerate                       # use gap_ranges from the DB
    bin/wayback-recover.py enumerate --from 19990101 --to 20010101
    bin/wayback-recover.py fetch [--limit N]               # fetch & extract pending candidates
    bin/wayback-recover.py status                          # show progress
    bin/wayback-recover.py reset-candidates                # clear unfetched candidates

Requires: pip install requests beautifulsoup4
"""

import os
import sys

# Self-bootstrap into the project venv. We compare sys.prefix (venv root when active)
# rather than sys.executable, because the venv's python symlinks back to system python
# and realpath would make them look identical.
_VENV_DIR = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".venv"))
_VENV_PY = os.path.join(_VENV_DIR, "bin", "python")
if os.path.exists(_VENV_PY) and os.path.realpath(sys.prefix) != _VENV_DIR:
    os.execv(_VENV_PY, [_VENV_PY] + sys.argv)

import argparse
import json
import re
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Missing deps. Run setup once:\n  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt")

# ─── config ───────────────────────────────────────────────────────────────────
PROJECT_DIR = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_DIR / "powerpage.db"
HOST = "powerpage.org"
USER_AGENT = "pp-twin-recovery/1.0 (archive reconstruction for powerpage.org owner)"
REQUEST_TIMEOUT = 60
CDX_TIMEOUT = 180
RATE_LIMIT_SECONDS = 1.0

# ─── URL classification ───────────────────────────────────────────────────────
SKIP_PATTERNS = [
    re.compile(r"\.(jpg|jpeg|gif|png|webp|css|js|ico|svg|woff|ttf|pdf|zip|mp3|mp4|mov|avi)(\?|$)", re.I),
    re.compile(r"/wp-admin/|/wp-content/|/wp-includes/|/wp-json/"),
    re.compile(r"/feed/?$|/rss/?$|/atom/?$|\.rss$|\.atom$"),
    re.compile(r"/(category|categories|tag|tags|author)/"),
    re.compile(r"/page/\d+/?$|[?&]paged=\d"),
    re.compile(r"/archives?/?$|/index\.html?$|/$"),
    re.compile(r"/comments?/|/trackback/?$|[?&]replytocom="),
    re.compile(r"\?attachment_id=|/attachment/"),
    re.compile(r"/web/\d+"),  # leaked wayback toolbar URLs
]

POST_HINTS = [
    (re.compile(r"/(\d{4})/(\d{1,2})/(\d{1,2})/[^/?#]+/?$"), 0.95, "wp-dated-slug"),
    (re.compile(r"/(\d{4})/(\d{1,2})/[^/?#]+/?$"),           0.85, "wp-month-slug"),
    (re.compile(r"[?&]p=(\d+)"),                              0.80, "wp-pid"),
    (re.compile(r"article\.php\?id=(\d+)", re.I),             0.75, "article-php"),
    (re.compile(r"story\.php\?id=(\d+)",   re.I),             0.75, "story-php"),
    (re.compile(r"/archives/(\d+)\.html?", re.I),             0.70, "archive-numeric"),
    (re.compile(r"/news/(\d{4})/(\d{1,2})/(\d{1,2})/"),       0.70, "news-dated"),
]

def classify_url(url):
    """Return (confidence: float, hint: str) or None if URL should be skipped."""
    for pat in SKIP_PATTERNS:
        if pat.search(url):
            return None
    for pat, conf, hint in POST_HINTS:
        m = pat.search(url)
        if m:
            return (conf, hint, m.groups())
    # Plain .html under a long path: low-confidence catch-all
    parsed = urlparse(url)
    if parsed.path.endswith((".html", ".htm")) and len(parsed.path) > 20:
        return (0.40, "plain-html", ())
    return None

def inferred_date_from_url(url, groups, hint):
    """Best-effort date extraction from the URL itself (string YYYY-MM-DD or None)."""
    try:
        if hint == "wp-dated-slug" and len(groups) >= 3:
            return f"{groups[0]}-{int(groups[1]):02d}-{int(groups[2]):02d}"
        if hint == "wp-month-slug" and len(groups) >= 2:
            return f"{groups[0]}-{int(groups[1]):02d}-01"
        if hint == "news-dated" and len(groups) >= 3:
            return f"{groups[0]}-{int(groups[1]):02d}-{int(groups[2]):02d}"
    except Exception:
        return None
    return None

# ─── schema ───────────────────────────────────────────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS peq_recovery_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_url       TEXT NOT NULL,
    cdx_timestamp      TEXT NOT NULL,
    inferred_date      TEXT,
    confidence         REAL,
    hint               TEXT,
    digest             TEXT,
    status             TEXT DEFAULT 'pending',  -- 'pending' | 'fetched' | 'failed' | 'skipped'
    fail_reason        TEXT,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(original_url, cdx_timestamp)
);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON peq_recovery_candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_date   ON peq_recovery_candidates(inferred_date);

CREATE TABLE IF NOT EXISTS peq_posts_recovered (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id           INTEGER REFERENCES peq_recovery_candidates(id),
    proposed_post_date     TEXT,
    proposed_post_title    TEXT,
    proposed_post_content  TEXT,
    proposed_post_author   TEXT,
    source                 TEXT,        -- 'wayback'
    source_url             TEXT,        -- the wayback snapshot URL
    source_original_url    TEXT,        -- the original powerpage.org URL
    source_snapshot_ts     TEXT,        -- 14-digit CDX timestamp
    confidence             REAL,
    reviewed               INTEGER DEFAULT 0,  -- 0=pending, 1=accepted, -1=rejected
    reviewer_notes         TEXT,
    merged_into_post_id    INTEGER,
    created_at             DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_recovered_date     ON peq_posts_recovered(proposed_post_date);
CREATE INDEX IF NOT EXISTS idx_recovered_reviewed ON peq_posts_recovered(reviewed);
"""

def open_db():
    if not DB_PATH.exists():
        sys.exit(f"Database not found at {DB_PATH}. Run sync first.")
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn

# ─── CDX ──────────────────────────────────────────────────────────────────────
def cdx_query(host, ts_from, ts_to, retries=3):
    """Returns a list of dicts: {urlkey, timestamp, original, mimetype, statuscode, digest, length}."""
    params = {
        "url": f"{host}/*",
        "from": ts_from,
        "to": ts_to,
        "output": "json",
        "filter": ["statuscode:200", "mimetype:text/html"],
        "collapse": "urlkey",
    }
    url = "https://web.archive.org/cdx/search/cdx"
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=CDX_TIMEOUT,
                             headers={"User-Agent": USER_AGENT})
            r.raise_for_status()
            data = r.json()
            if not data:
                return []
            header, *rows = data
            return [dict(zip(header, row)) for row in rows]
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  CDX retry {attempt+1}/{retries} after error: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)

# ─── enumerate ────────────────────────────────────────────────────────────────
def gap_ranges_to_windows(conn, min_weekdays=5):
    """Pull gap_ranges with at least N weekdays, return list of (from, to) 8-digit dates."""
    rows = conn.execute("""
        SELECT start_day, end_day, weekday_count
        FROM gap_ranges
        WHERE weekday_count >= ?
        ORDER BY weekday_count DESC
    """, (min_weekdays,)).fetchall()
    return [(r[0].replace("-",""), r[1].replace("-",""), r[2]) for r in rows]

def enumerate_window(conn, ts_from, ts_to, host=HOST):
    print(f"  CDX {host}/* {ts_from} → {ts_to}")
    rows = cdx_query(host, ts_from, ts_to)
    print(f"  CDX returned {len(rows)} crawled URLs", file=sys.stderr)
    inserted = skipped = 0
    cur = conn.cursor()
    for row in rows:
        original = unquote(row["original"])
        cls = classify_url(original)
        if not cls:
            skipped += 1
            continue
        confidence, hint, groups = cls
        inferred = inferred_date_from_url(original, groups, hint)
        try:
            cur.execute("""
                INSERT OR IGNORE INTO peq_recovery_candidates
                  (original_url, cdx_timestamp, inferred_date, confidence, hint, digest)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (original, row["timestamp"], inferred, confidence, hint, row.get("digest")))
            if cur.rowcount:
                inserted += 1
        except Exception as e:
            print(f"  insert error for {original}: {e}", file=sys.stderr)
    conn.commit()
    print(f"  staged {inserted} new, skipped {skipped} non-post URLs (already had {len(rows)-inserted-skipped} dupes)")
    return inserted

def cmd_enumerate(args):
    conn = open_db()
    if args.from_ts and args.to_ts:
        windows = [(args.from_ts, args.to_ts, None)]
    else:
        windows = gap_ranges_to_windows(conn, args.min_gap)
        print(f"Using {len(windows)} gap windows from gap_ranges (min {args.min_gap} weekdays each)")
    total = 0
    for i, (ts_from, ts_to, weekdays) in enumerate(windows, 1):
        label = f" ({weekdays}d gap)" if weekdays else ""
        print(f"\n[{i}/{len(windows)}] window {ts_from}–{ts_to}{label}")
        try:
            total += enumerate_window(conn, ts_from, ts_to)
        except Exception as e:
            print(f"  window failed: {e}", file=sys.stderr)
        time.sleep(RATE_LIMIT_SECONDS)
    print(f"\nDone. {total} new candidates staged total.")

# ─── fetch + extract ──────────────────────────────────────────────────────────
def fetch_snapshot(timestamp, original_url):
    snap_url = f"https://web.archive.org/web/{timestamp}id_/{original_url}"
    # "id_" suffix asks Wayback to return the original page content without injected toolbar
    r = requests.get(snap_url, timeout=REQUEST_TIMEOUT,
                     headers={"User-Agent": USER_AGENT}, allow_redirects=True)
    r.raise_for_status()
    return r.text, snap_url

def extract_post(html, original_url):
    soup = BeautifulSoup(html, "html.parser")
    # Strip any leftover wayback chrome
    for tag in soup.find_all(id=re.compile(r"^(wm-|wayback|donato)", re.I)):
        tag.decompose()
    for tag in soup.find_all(class_=re.compile(r"^(wm-|wayback)", re.I)):
        tag.decompose()

    def pick(*candidates):
        for c in candidates:
            if c:
                return c
        return None

    # Title
    title_el = pick(
        soup.find(["h1","h2"], class_=re.compile(r"entry-title|post-title|article-title")),
        soup.find("meta", attrs={"property": "og:title"}),
        soup.find("h1"),
        soup.find("title"),
    )
    title = None
    if title_el is not None:
        title = title_el.get("content") if title_el.name == "meta" else title_el.get_text(strip=True)

    # Body
    body_el = pick(
        soup.find("div",  class_=re.compile(r"entry-content|post-content|article-content|story-body|content-body")),
        soup.find("article"),
        soup.find("div",  id=re.compile(r"content$|post-\d+|main-content")),
        soup.find("div",  class_="post"),
    )
    body = str(body_el) if body_el else None

    # Author
    author_el = pick(
        soup.find("a",   rel="author"),
        soup.find(["a","span","div"], class_=re.compile(r"author-name|byline|author")),
        soup.find("meta", attrs={"name": "author"}),
    )
    author = None
    if author_el is not None:
        author = author_el.get("content") if author_el.name == "meta" else author_el.get_text(strip=True)

    # Date
    date_str = None
    date_el = pick(
        soup.find("meta", attrs={"property": "article:published_time"}),
        soup.find("meta", attrs={"name": "date"}),
        soup.find("time"),
        soup.find(class_=re.compile(r"post-date|entry-date|published")),
    )
    if date_el is not None:
        date_str = date_el.get("datetime") or date_el.get("content") or date_el.get_text(strip=True)

    return {"title": title, "body": body, "author": author, "date": date_str}

def normalize_date(s):
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d", "%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s[:len(fmt)+5], fmt).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            continue
    return None

def cmd_fetch(args):
    conn = open_db()
    where = "status='pending'"
    if args.min_confidence:
        where += f" AND confidence >= {float(args.min_confidence)}"
    sql = f"""SELECT id, original_url, cdx_timestamp, inferred_date, confidence
              FROM peq_recovery_candidates
              WHERE {where}
              ORDER BY confidence DESC, cdx_timestamp ASC
              LIMIT ?"""
    rows = conn.execute(sql, (args.limit,)).fetchall()
    if not rows:
        print("No pending candidates. Run `enumerate` first.")
        return
    print(f"Fetching {len(rows)} candidates (min confidence={args.min_confidence or 'any'})…")
    ok = failed = 0
    for cand_id, url, ts, inferred, conf in rows:
        try:
            html, snap_url = fetch_snapshot(ts, url)
            data = extract_post(html, url)
            best_date = (normalize_date(data["date"]) or inferred
                         or f"{ts[:4]}-{ts[4:6]}-{ts[6:8]} {ts[8:10]}:{ts[10:12]}:{ts[12:14]}")
            conn.execute("""
                INSERT INTO peq_posts_recovered
                  (candidate_id, proposed_post_date, proposed_post_title, proposed_post_content,
                   proposed_post_author, source, source_url, source_original_url,
                   source_snapshot_ts, confidence)
                VALUES (?, ?, ?, ?, ?, 'wayback', ?, ?, ?, ?)
            """, (cand_id, best_date, data["title"], data["body"], data["author"],
                  snap_url, url, ts, conf))
            conn.execute("UPDATE peq_recovery_candidates SET status='fetched' WHERE id=?", (cand_id,))
            ok += 1
            title_disp = (data["title"] or "(no title)")[:80]
            print(f"  ✓ {best_date[:10]} · {title_disp}")
        except Exception as e:
            conn.execute("UPDATE peq_recovery_candidates SET status='failed', fail_reason=? WHERE id=?",
                         (str(e)[:200], cand_id))
            failed += 1
            print(f"  ✗ {url[:80]} → {e}", file=sys.stderr)
        conn.commit()
        time.sleep(RATE_LIMIT_SECONDS)
    print(f"\nDone. {ok} fetched, {failed} failed.")

# ─── status ───────────────────────────────────────────────────────────────────
def cmd_status(args):
    conn = open_db()
    print("=== Recovery candidates ===")
    for row in conn.execute("SELECT status, COUNT(*) n FROM peq_recovery_candidates GROUP BY status ORDER BY n DESC"):
        print(f"  {row[0]:10} {row[1]:>6}")
    total_c = conn.execute("SELECT COUNT(*) FROM peq_recovery_candidates").fetchone()[0]
    print(f"  {'TOTAL':10} {total_c:>6}")

    print("\n=== Confidence distribution (pending) ===")
    for row in conn.execute("""
        SELECT
          CASE WHEN confidence >= 0.9 THEN 'high (>=0.9)'
               WHEN confidence >= 0.7 THEN 'med  (>=0.7)'
               WHEN confidence >= 0.5 THEN 'low  (>=0.5)'
               ELSE 'minimal (<0.5)' END AS bucket,
          COUNT(*) n
        FROM peq_recovery_candidates
        WHERE status='pending'
        GROUP BY bucket ORDER BY n DESC"""):
        print(f"  {row[0]:18} {row[1]:>6}")

    print("\n=== Hint distribution ===")
    for row in conn.execute("SELECT hint, COUNT(*) n FROM peq_recovery_candidates GROUP BY hint ORDER BY n DESC"):
        print(f"  {row[0]:20} {row[1]:>6}")

    print("\n=== Recovered posts (peq_posts_recovered) ===")
    for row in conn.execute("SELECT reviewed, COUNT(*) n FROM peq_posts_recovered GROUP BY reviewed"):
        label = {0:"pending", 1:"accepted", -1:"rejected"}.get(row[0], str(row[0]))
        print(f"  {label:10} {row[1]:>6}")
    total_r = conn.execute("SELECT COUNT(*) FROM peq_posts_recovered").fetchone()[0]
    print(f"  {'TOTAL':10} {total_r:>6}")

    print("\n=== Year distribution of inferred dates (pending+fetched) ===")
    for row in conn.execute("""
        SELECT substr(inferred_date,1,4) yr, COUNT(*) n
        FROM peq_recovery_candidates
        WHERE inferred_date IS NOT NULL
        GROUP BY yr ORDER BY yr"""):
        print(f"  {row[0]}  {row[1]:>6}")

def cmd_reset_candidates(args):
    conn = open_db()
    n = conn.execute("DELETE FROM peq_recovery_candidates WHERE status='pending'").rowcount
    conn.commit()
    print(f"Cleared {n} pending candidates")

# ─── main ─────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_enum = sub.add_parser("enumerate", help="Stage CDX candidates for gap windows")
    p_enum.add_argument("--from", dest="from_ts", help="YYYYMMDD start (default: use gap_ranges view)")
    p_enum.add_argument("--to",   dest="to_ts",   help="YYYYMMDD end")
    p_enum.add_argument("--min-gap", type=int, default=5, help="Min weekday count for a gap range to scan (default 5)")
    p_enum.set_defaults(func=cmd_enumerate)

    p_fetch = sub.add_parser("fetch", help="Fetch & extract pending candidates")
    p_fetch.add_argument("--limit", type=int, default=50)
    p_fetch.add_argument("--min-confidence", type=float, default=0.7)
    p_fetch.set_defaults(func=cmd_fetch)

    p_status = sub.add_parser("status", help="Show recovery progress")
    p_status.set_defaults(func=cmd_status)

    p_reset = sub.add_parser("reset-candidates", help="Clear pending candidates")
    p_reset.set_defaults(func=cmd_reset_candidates)

    args = ap.parse_args()
    args.func(args)

if __name__ == "__main__":
    main()
