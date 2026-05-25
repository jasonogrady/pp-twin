# Hunter — 24/7 archive recovery daemon

The complement to [`RECOVERY.md`](RECOVERY.md). RECOVERY is the one-shot human playbook; HUNTER is the always-on automation that runs on a Mac mini, learns from what's working, and proposes its own improvements.

This document is design intent — none of it is built yet beyond the existing single-source `bin/wayback-recover.py`. The phasing at the bottom is the build order.

---

## What's missing (snapshot 2026-05-24)

| Metric | Count |
|---|---|
| Missing weekdays total | 2,247 |
| Distinct gap ranges | 151 |
| Major ranges (≥5 weekdays) | 8 |
| Smaller ranges (2-4 weekdays) | 143 |
| Recovery candidates staged | 0 (until first hunter run) |
| Recovered posts in review | 0 |

Major ranges by weekday count:

| # | Range | Weekdays | Era / theory |
|---|---|---|---|
| 1 | 1995-12-01 → 1999-01-29 | 826 | Pre-WordPress — different CMS or hand-rolled HTML |
| 2 | 1999-02-02 → 2001-07-16 | 640 | Early WP. The 1,661 "1999" posts are all stamped `1999-02-01` — bodies likely fine, original timestamps lost during a migration |
| 3 | 2007-09-06 → 2008-12-25 | 341 | The "missing 2008" — likely a hosting outage / lost backup / failed migration |
| 4 | 2003-09-05 → 2004-07-05 | 217 | 10-month dark window |
| 5 | 2008-12-30 → 2009-02-10 | 31 | Tail of #3 |
| 6 | 2002-10-30 → 2002-11-05 | 5 | Noise-level (probably a long weekend) |
| 7 | 2013-10-15 → 2013-10-21 | 5 | Noise |
| 8 | 2013-12-23 → 2013-12-27 | 5 | Holiday gap |

The canonical lists are in the DB and stay live:

```sql
SELECT day, weekday FROM gap_days ORDER BY day;        -- 2,247 rows, one per missing weekday
SELECT * FROM gap_ranges ORDER BY weekday_count DESC;  -- 151 contiguous runs
SELECT * FROM gap_summary ORDER BY year;               -- per-year coverage rollup
```

### Two recovery problems hide in here

- **Reconstruct content** for 2,247 missing days (ranges 1-5). Requires sourcing entire posts.
- **Re-date** the 1,661 posts already in the DB but stamped `1999-02-01` (range 2). Bodies are fine; the original timestamp is what's lost. Even a Wayback page URL of the form `/YYYY/MM/DD/slug/` is enough — no body fetch needed.

The hunter must handle both. The first is a content-recovery pipeline; the second is more or less just URL→date metadata mining.

---

## Source inventory

### archive.org Wayback Machine — primary
CDX index returns every snapshotted URL by timestamp. `bin/wayback-recover.py` already does this. Most expected yield (~70-80% of post-2001 gaps).

### archive.today / archive.ph / archive.is
Independent snapshot service. Often has different captures than Wayback, especially for paywalled or short-lived pages. Public search at `https://archive.ph/https://www.powerpage.org`. No official API; rate-limit aggressively.

### Common Crawl
Quarterly crawls back to 2008. Free, S3-hosted WARC archives indexed via CDX. Slow but very high coverage for the 2008+ window. URL: `https://index.commoncrawl.org/`.

### Bing Cache
Still serves `cc.bingj.com/cache.aspx?...` for indexed pages. Useful for recently-indexed content only — not historical recovery.

### Yandex Cache
Equivalent to Bing's. Sometimes has pages others have purged.

### ~~Google Cache~~
**Discontinued September 2024.** The `cache:` operator is gone and cached pages are no longer served. Do not waste cycles here.

### Megalodon.jp
Japanese Wayback equivalent. Limited coverage of US Mac blogs but some hits exist.

### Secondary / linked-from sources
Useful for *confirming dates and headlines* even when bodies are unrecoverable:

- **MacRumors forums** — Discourse search back to 2000
- **TUAW (The Unofficial Apple Weblog)** — defunct, Wayback-only
- **Daring Fireball /linked** — Gruber's link blog from 2004
- **AppleInsider forums**
- **Slashdot** Apple section
- **comp.sys.mac.advocacy / .system** via Google Groups (Usenet archives) — frequently quoted PP with timestamps
- **Reddit r/apple** — useful for the 2008+ era

### Original-source material
Higher yield per minute than scraping:

- **Personal email** — `mdfind` Mail.app and Gmail Takeout for `from:*@powerpage.org` / `to:*@powerpage.org` 1995-2008. Drafts and pitches preserve dates + bodies.
- **Old Macs / Time Machine / SuperDuper backups** — Manila / Frontier / MovableType local installs from the pre-2003 era.
- **Contributors** — Connie Guglielmo and other 2000s-era staff. One email each.
- **Print syndication** — MacWorld / MacAddict columns may have your bylines with dates.

---

## Architecture

Single long-running Python daemon under launchd. Pluggable source adapters. Self-tuning scheduler. Writes to the same `powerpage.db` you already have.

```
bin/hunter/
  hunterd.py                   # main loop; launchd KeepAlive=true
  scheduler.py                 # picks next (source, gap) job via Thompson sampling
  sources/
    __init__.py                # SourceAdapter protocol
    wayback.py                 # (refactor of wayback-recover.py)
    archive_today.py
    common_crawl.py
    bing_cache.py
    macrumors_forum.py
    daringfireball.py
    google_groups.py
    local_mail.py              # mdfind into Mail.app + Gmail Takeout
    local_backups.py           # mdfind across /Volumes
  extract/
    base.py                    # candidate → {title, body, author, date}
    learners.py                # heuristic-improvement code
  telemetry.py                 # per-source metrics → hunter_telemetry table
  proposals/                   # self-improvement suggestions land here as markdown
```

Each source implements a tiny protocol:

```python
class SourceAdapter(Protocol):
    name: str
    rate_limit_per_minute: int
    def enumerate(self, gap: DateRange) -> Iterator[Candidate]: ...
    def fetch(self, candidate: Candidate) -> RawDocument | FetchFailure: ...
```

### Persistence (extends `powerpage.db`)

Alongside the existing `peq_recovery_candidates` and `peq_posts_recovered`:

```sql
CREATE TABLE hunter_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source           TEXT NOT NULL,
  gap_start        TEXT NOT NULL,
  gap_end          TEXT NOT NULL,
  status           TEXT DEFAULT 'queued',   -- queued | running | done | failed | backoff
  attempts         INTEGER DEFAULT 0,
  last_attempt_at  DATETIME,
  next_attempt_at  DATETIME,
  notes            TEXT
);

CREATE TABLE hunter_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source           TEXT NOT NULL,
  day              TEXT NOT NULL,          -- YYYY-MM-DD bucket
  enumerated       INTEGER DEFAULT 0,
  fetched_ok       INTEGER DEFAULT 0,
  fetched_fail     INTEGER DEFAULT 0,
  accepted         INTEGER DEFAULT 0,      -- after human review
  rejected         INTEGER DEFAULT 0,
  ms_spent         INTEGER DEFAULT 0,
  bytes_in         INTEGER DEFAULT 0,
  UNIQUE(source, day)
);

CREATE TABLE hunter_url_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source                     TEXT,
  regex                      TEXT NOT NULL,
  hint                       TEXT,
  learned_from_candidate_id  INTEGER,
  alpha                      REAL DEFAULT 1.0,  -- Beta posterior
  beta                       REAL DEFAULT 1.0,
  sample_count               INTEGER DEFAULT 0,
  promoted                   INTEGER DEFAULT 0, -- 0=experimental, 1=in active rotation
  created_at                 DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE hunter_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  kind        TEXT,                          -- extractor | source | pattern | range | other
  title       TEXT,
  body_md     TEXT,
  status      TEXT DEFAULT 'open',           -- open | applied | dismissed | snoozed
  resolved_at DATETIME
);

CREATE TABLE hunter_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

---

## The "learn from experience" loop

Three concrete self-tuning mechanisms, ordered by ROI:

### 1. Source allocation via Thompson sampling
Each source has a `Beta(α, β)` over its "candidates → accepted post" rate, updated whenever you accept/reject in the review queue. The scheduler samples per source per tick and picks the source with the highest sampled rate. Effort migrates automatically to whichever source is paying off, no manual tuning.

Cold-start: uniform `Beta(1,1)` prior. First ~100 attempts per source are exploratory regardless of yield, so a slow-warming source doesn't get starved.

### 2. URL-pattern mining
When a human-accepted candidate is merged, the daemon takes its original URL and runs it through a regex generalizer:
- replace `\d+` runs with `\d+`
- replace slugs with `[^/]+`
- preserve directory structure

The generalized pattern goes into `hunter_url_patterns` with a weak prior. As future candidates match it:
- Match → accepted: `α += 1`
- Match → rejected: `β += 1`

Patterns with `α / (α+β) > 0.5` and `sample_count >= 10` get promoted into active enumeration. This is how the system *discovers* that `/story.php?id=N` was the pre-WP URL shape without anyone telling it.

### 3. Extractor failure diagnostics
Every fetch that produces `title=None` or `body=None` is logged with the HTML's structural fingerprint (template class names, meta tag set, body length). When ≥10 failures share a fingerprint:

```markdown
# proposals/2026-06-03-extractor-story-php.md

23 candidates from `*/story.php?id=*` returned title=ok body=None.

All share: `<div class="story-text">…</div>` (no `entry-content`).

Suggested change: add `"story-text"` to the body selector regex in `extract/base.py:body_el`.

Sample URLs (first 5):
- https://web.archive.org/web/20020415/http://powerpage.org/story.php?id=4421
- ...
```

You either edit `extract/base.py` and the daemon re-tries the failures, or you mark the proposal dismissed.

---

## "Suggests ways to improve itself"

Two layers, both write to `hunter_proposals` and surface in pp-twin's Hunter tab.

### Rule-based (deterministic, free)
Cron-like checks run nightly:
- Source X has 0% yield in 7 days → suggest disabling
- Wayback returns 429 frequently → suggest lowering rate limit
- Gap range #4 has been scanned by 5 sources with 0 results → suggest manual review or contributor outreach
- Extractor missed date on 80% of candidates from source Y → suggest extractor proposal
- New URL pattern in active rotation crossed promotion threshold → notify
- Range has been "done" by source Z but contains 0 results → re-queue with different params

### LLM-assisted (optional, opt-in)
Once a week, a small job concatenates the week's telemetry and 20 failure samples and asks Claude to write a single proposal markdown. Cheap (Haiku 4.5 is more than enough), bounded to one call per week, and the output is just a human-reviewed markdown file — **no autonomous code edits**.

---

## Headless monitoring

Three complementary surfaces. None of them require an extra always-on app — they piggyback on tools you already have.

### 1. ntfy.sh push (real-time, "find out when something matters")

The daemon sends a one-line POST on events worth your attention. Free, no account, install the iOS app once and you get push notifications anywhere.

```python
# bin/hunter/notify.py
import requests
NTFY_TOPIC = "pp-twin-hunter-<random-suffix>"  # secret-ish; topic is the URL

def notify(title: str, body: str, priority: int = 3, tags: list[str] | None = None):
    requests.post(
        f"https://ntfy.sh/{NTFY_TOPIC}",
        data=body.encode("utf-8"),
        headers={
            "Title": title,
            "Priority": str(priority),
            "Tags": ",".join(tags or []),
        },
        timeout=10,
    )
```

What to notify on (and at what priority):

| Event | Priority | Example |
|---|---|---|
| Critical source failure | 4 (high) | "wayback returning 503 for 30+ min — daemon pausing" |
| New proposal opened | 3 (default) | "Extractor proposal: `/story.php?id=*` body selector (23 samples)" |
| Daily digest at 9 AM | 2 (low) | "Yesterday: 234 fetched, 41 accepted, 0 new proposals" |
| Milestone hit | 3 | "Range 2007-09 → 2008-12 now 84% recovered (was 0%)" |
| New high-confidence URL pattern | 2 | "Promoted pattern: `/news/YYYY/MM/DD/` (89% accept rate over 47 samples)" |

Subscribe on iOS: install [ntfy](https://apps.apple.com/app/ntfy/id1625396347), add topic `pp-twin-hunter-<suffix>`. Subscribe on the web: open `https://ntfy.sh/pp-twin-hunter-<suffix>` in a browser. No backend, no auth, no ongoing cost.

(Pushover and ntfy self-hosted are drop-in alternatives if you prefer.)

### 2. TUI dashboard (live picture, SSH-friendly)

`bin/hunter/tui.py` built on [Textual](https://textual.textualize.io/). Read-only against the daemon's tables. Refresh every 2s.

```
┌─ Hunter ──────────────────────────── 2026-05-24 16:42 ┐
│ wayback     ▇▇▇▇▇▇▇▇▁▁  243/420  acc 12%  rate 50/min│
│ archive.ph  ▇▇▇▁▁▁▁▁▁▁   31/180  acc  8%  rate 20/min│
│ commoncrawl ▇▇▇▇▇▇▇▇▇▇  812/812  acc 22%  rate idle  │
│ macrumors   ▁▁▁▁▁▁▁▁▁▁    0/—   backoff (429)        │
│                                                       │
│ Last 5 accepted:                                      │
│ 2008-03-14 · "Apple ships 10.5.2 update"  · wayback   │
│ ...                                                   │
│ Open proposals: 3 (press P to view)                   │
│ Pending review: 87 (press R to open review queue)     │
└───────────────────────────────────────────────────────┘
```

SSH into the mini, `bin/hunter/tui.py`, see live state in 1s. Zero deploy, zero browser.

### 3. pp-twin "Hunter" tab (work surface, web-reachable)

Lives at your Cloudflare Pages URL. Reads the same SQLite tables as the TUI but adds the interactive parts: accept/reject the review queue, accept/dismiss/snooze proposals, promote/demote URL patterns. This is where the actual human work happens; the TUI and ntfy are read-only signals.

### Why this stack, not a standalone web dashboard

A separate hunter web dashboard (Cloudflare Tunnel → local HTTP server → static page polling JSON) is more code and more moving parts for the same information. The trio above already covers all three modes — *find out*, *look at*, *work on* — without a new long-running web server. Add it later only if you want a dashboard reachable from a phone without the ntfy app installed.

## pp-twin integration

New tab: **Hunter**.

| Panel | What it shows |
|---|---|
| Live source status | Per-source: queue depth, last fetch, rate-limit headroom, current Beta posterior |
| Telemetry sparklines | 30-day enumerated / fetched / accepted per source |
| Proposal inbox | Open `hunter_proposals` with accept / dismiss / snooze controls |
| Review queue | Existing `peq_posts_recovered` flow — accept / reject / edit |
| Patterns | `hunter_url_patterns` table with promote / demote controls |

The review queue feedback (accept/reject) is what updates the Beta posteriors that drive the scheduler — humans don't tune the system, they just review.

---

## Safety rails

- **Never writes to `peq_posts`.** Only `peq_posts_recovered`. Human in the loop for every merge.
- **Per-source rate limits**, daemon-enforced via token bucket. Robots.txt respected.
- **No self-modifying code.** Proposals are markdown — never auto-applied patches.
- **Single-writer SQLite**, WAL mode. Daemon is the only writer; pp-twin is read-only against `peq_posts_recovered`.
- **launchd `ThrottleInterval`** so a crash loop doesn't hammer Wayback.
- **Backup hook** — before every accept-merge, snapshot `powerpage.db` into the existing 7-day rotation.
- **Kill switch** — `bin/hunter/stop` sets `hunter_settings.paused=1` and the daemon idles within 60s.

---

## Currently shipped: GitHub Actions cron MVP

The full daemon design above is the destination. Today (May 2026) a slim MVP is running:

- **Host:** GitHub Actions, free, cron `37 */2 * * *` (every 2 hours)
- **State:** `recovery/hunter.db` — a 1.4 MB SQLite committed to the repo, contains `peq_recovery_candidates`, `peq_posts_recovered` (no bodies), `hunter_gap_queue`, `hunter_runs`
- **Per-run budget:** one stale gap window enumerated (if any is due) + up to 30 fetches per tick
- **Idempotent:** `concurrency.group: hunter` prevents overlap; if nothing changed, no commit
- **Audit trail:** every run logs to `hunter_runs`; every commit message is `hunter tick — recovered=N cand=… fetched=… …`

Workflow file: [`.github/workflows/hunter.yml`](.github/workflows/hunter.yml)
Trigger manually: GitHub → Actions → `hunter` → **Run workflow** (lets you override `limit`, `min_confidence`, `reenumerate_days`).

### Local merge

```zsh
bin/hunter-merge-local.sh           # pull + merge cloud rows into powerpage.db
bin/hunter-merge-local.sh --dry-run # show what would change
```

The merge is **idempotent** and matches rows by `(original_url, cdx_timestamp)` for candidates and `(source_original_url, source_snapshot_ts)` for recovered posts. Re-running is a no-op.

### Limits and growth

- **Disk:** ~150 bytes per candidate, ~300 bytes per recovered row (no body). 5,000 / 1,000 = ~1.6 MB. Git can sustain this for years. If bodies are needed, fetch them on-demand locally at accept-time.
- **Wayback rate-limiting:** GH Actions runners share IPs; expect occasional 429s. The retry-with-backoff on `fetch_snapshot` handles these.
- **CDX timeouts:** each gap window is chunked to ≤365d and called separately; large windows that 504 retry up to 3× with backoff.

### Next steps to move closer to the full daemon

1. Add per-source telemetry (`hunter_telemetry`) so the Thompson scheduler has data to work from.
2. Add additional source adapters (`archive.today`, `common_crawl`) — same `tick`-style interface.
3. Surface `hunter_runs` and live activity in the pp-twin Hunter tab via a fetch of the raw `recovery/hunter.db` from GitHub (no need to wait for local merge).

## Build phasing

1. **Today (10 min)** — run the existing scraper end-to-end. `bin/wayback-recover.py enumerate && bin/wayback-recover.py fetch --limit 200`. Baseline what Wayback alone covers before building more.
2. **This week** — materialize `recovery/missing_days.csv` snapshot. Run the `mdfind` searches from RECOVERY.md §2 to exhaust local backups. Cheapest yield-per-minute.
3. **Week 2** — refactor `wayback-recover.py` into `bin/hunter/sources/wayback.py` matching the `SourceAdapter` protocol. Add `archive_today.py` and `common_crawl.py`. Launchd-ify as `hunterd`.
4. **Week 3** — telemetry tables + Thompson scheduler + URL-pattern miner.
5. **Week 4** — Hunter tab in pp-twin (proposal inbox + telemetry sparklines + pattern controls).
6. **Later** — LLM-assisted weekly proposal, contributor-outreach automation, secondary-source date-confirmation pipeline for the 1999-stamp problem.
