# pp-twin

A local archive explorer + recovery toolkit for [O'Grady's PowerPage](https://www.powerpage.org) — a long-running Apple/Mac blog. Pulls your WordPress database nightly, gives you an instant dashboard, an editorial cockpit, gap analysis, and a Wayback-Machine-driven recovery pipeline for lost posts.

![status](https://img.shields.io/badge/status-v1.0-gold) ![license](https://img.shields.io/badge/license-MIT-green)

---

## Features

| Tab | What it does |
|-----|-------------|
| **Dashboard** | Stat cards, monthly area chart, posts by year/author/category, recent posts feed |
| **SQL Explorer** | Table sidebar (incl. views), live SQL editor (⌘↵ to run), paginated results |
| **Post Calendar** | Editorial cockpit (16+ metrics: volume, cadence, streaks, engagement, top author/cat/tag/year), GitHub-style heatmap, 12-month grid |
| **Gaps** | Year coverage bar chart, top contiguous gap ranges with one-click Wayback links, draft queue |

Plus, outside the UI:

- **Daily Bluehost sync** — a launchd agent runs at 3:30 AM, streams `wp db export` over SSH, converts MySQL → SQLite, rebuilds views/indexes, atomic-swaps `powerpage.db`, keeps 7 dated backups
- **Wayback recovery scraper** — `bin/wayback-recover.py` enumerates archive.org's CDX index for your gap windows, fetches snapshots, extracts post body/title/date/author, stages into `peq_posts_recovered` for review
- **Auto-detection of WordPress table prefix** — works with any prefix (PowerPage uses `peq_`), creates `wp_*` view aliases so dashboard queries stay portable

---

## Stack

- **React** — single self-contained JSX file (`pp-twin.jsx`), no build step required for the artifact
- **Vite** dev workspace at `pp-twin-dev/` — for local hacking with HMR
- **[sql.js](https://github.com/sql-js/sql.js)** `1.10.2` — in-browser SQLite via WebAssembly (loaded from cdnjs at runtime, never bundled)
- **[recharts](https://recharts.org)** — area + bar charts
- **Python 3** + `requests` + `beautifulsoup4` — recovery scraper (managed via `.venv/`)
- Runs entirely on your machine; nothing leaves it except the Wayback Machine HTTP requests when running the scraper

---

## Quick start

### 1. Pull the dev workspace

```zsh
npm create vite@latest pp-twin-dev -- --template react
cp pp-twin.jsx pp-twin-dev/src/App.jsx
cd pp-twin-dev && npm install recharts && npm run dev
```

Open http://localhost:5173 and use the **📂 Load powerpage.db** banner button to pick your SQLite file.

### 2. Get a real `powerpage.db`

The fastest path is via your WordPress install on Bluehost (or any shared host with WP-CLI):

```bash
ssh user@your-host
cd ~/public_html
wp db export - --single-transaction --quick --default-character-set=utf8mb4 | gzip > ~/wp.sql.gz
exit
scp user@your-host:~/wp.sql.gz . && gunzip wp.sql.gz
curl -fsSL -o mysql2sqlite https://raw.githubusercontent.com/dumblob/mysql2sqlite/master/mysql2sqlite && chmod +x mysql2sqlite
./mysql2sqlite wp.sql | sqlite3 powerpage.db
```

If your WP install uses a non-default table prefix (PowerPage uses `peq_`), create alias views so pp-twin's queries work:

```bash
sqlite3 powerpage.db "
CREATE VIEW wp_posts              AS SELECT * FROM peq_posts;
CREATE VIEW wp_users              AS SELECT * FROM peq_users;
CREATE VIEW wp_terms              AS SELECT * FROM peq_terms;
CREATE VIEW wp_term_taxonomy      AS SELECT * FROM peq_term_taxonomy;
CREATE VIEW wp_term_relationships AS SELECT * FROM peq_term_relationships;
CREATE VIEW wp_comments           AS SELECT * FROM peq_comments;"
```

Then apply gap analysis views: `sqlite3 powerpage.db < sql/gap-views.sql`

### 3. Automate the sync (optional, recommended)

Edit `bin/sync-from-bluehost.sh` to match your host/user, then:

```zsh
ssh-add --apple-use-keychain ~/.ssh/id_ed25519_yourhost   # cache passphrase
bin/sync-from-bluehost.sh                                 # dry-run
bin/install-launchd.sh install                            # schedule daily at 3:30 AM
```

The script auto-detects the WP table prefix, rebuilds alias views + gap views + missing MySQL indexes, performs an atomic swap, and rotates 7 days of compressed backups.

---

## Editor dashboard (Post Calendar tab)

Designed for a publisher/EIC at-a-glance read:

**Volume row** — Total Posts · Posts {year} (with YoY %) · Avg/Week · Last 30 Days · Last Published · Authors Active · Longest Streak · Current Streak

**Engagement row** — Total Comments · Posts w/ Comments · Posts ≥10 Comments · Top Author this year · Top Category this year · Top Tag this year · Avg Post Length · Distinct Tags

**Charts** — 52-week weekly cadence sparkline · Top 5 Weeks all-time · Most-Discussed Posts all-time

Tag counts use WordPress's denormalized `term_taxonomy.count` and indexed joins to stay fast even on a 1.2 GB DB with 27k tags.

---

## Gap analysis

`sql/gap-views.sql` defines three views:

- `gap_days` — every Mon-Fri between 1995-12-01 and today with zero published posts
- `gap_ranges` — contiguous gap runs (weekends don't break a run)
- `gap_summary` — per-year coverage rollup

The Gaps tab visualizes these as a year coverage chart, a top-25 gap-range table with one-click Wayback Machine links, and an unpublished drafts queue.

---

## 24/7 cloud Hunter

`recovery/hunter.db` is a slim SQLite (no post bodies) maintained by a GitHub Actions cron — every 2 hours, the workflow enumerates one stale gap and fetches up to 30 candidates, then commits results back.

```zsh
bin/hunter-merge-local.sh           # pull cloud rows into powerpage.db, then reload pp-twin
bin/hunter-merge-local.sh --dry-run # show what would change
```

Trigger a run on demand: GitHub → Actions → **hunter** → **Run workflow** (with optional `limit` / `min_confidence` / `reenumerate_days` overrides).

Full design: [`HUNTER.md`](HUNTER.md).

## Recovery workflow

See [`RECOVERY.md`](RECOVERY.md) for the full plan and source-ranking. Quick start:

```zsh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
bin/wayback-recover.py enumerate                     # populates peq_recovery_candidates from gap_ranges
bin/wayback-recover.py fetch --limit 20              # fetches & extracts snapshots into peq_posts_recovered
bin/wayback-recover.py status                        # progress
```

Candidates are staged into `peq_recovery_candidates`; extracted posts land in `peq_posts_recovered` with `reviewed=0` until you accept/reject them.

---

## Hosting (Cloudflare Pages)

The app shell is static — the database stays on your machine. Host the shell at a permanent URL; the "📂 Load powerpage.db" picker handles the local file every time.

One-time setup:

```zsh
npm install -g wrangler           # or use npx
wrangler login                    # browser auth, ~30 seconds
bin/deploy-pages.sh               # builds pp-twin-dev/ and creates the Pages project
```

This prints a URL like `https://pp-twin.pages.dev` — bookmark it.

Auto-deploy on every push (recommended): connect the GitHub repo via the Cloudflare dashboard → Workers & Pages → pp-twin → Settings → Builds & deployments → Git integration. Then every `git push origin main` rebuilds and redeploys in ~30s.

To attach a custom domain (e.g. `twin.powerpage.org`): Pages project → Custom domains → Set up.

Re-deploy manually any time: `bin/deploy-pages.sh`.

## Repo layout

```
pp-twin.jsx                  source-of-truth single-file artifact
pp-twin-dev/                 Vite + React workspace (App.jsx is a copy of pp-twin.jsx)
wrangler.jsonc               Cloudflare Pages config
bin/
  sync-from-bluehost.sh      daily DB sync (launchd-driven)
  ai.ogrady.pptwin-sync.plist
  install-launchd.sh         load/unload the LaunchAgent
  wayback-recover.py         CDX-based archive scraper
  deploy-pages.sh            build + deploy pp-twin to Cloudflare Pages
sql/
  gap-views.sql              gap_days / gap_ranges / gap_summary
RECOVERY.md                  archive-recovery plan + source ranking
HUNTER.md                    24/7 self-improving recovery daemon (design)
requirements.txt             Python deps for the scraper
```

---

## Changelog

### v1.0 — editor cockpit + automation
- **Editor dashboard** on Post Calendar tab: 16 metrics + 52-week sparkline + top weeks + most-discussed posts
- **Gaps tab** with year coverage bars, top contiguous gap ranges, drafts queue
- **Daily Bluehost sync** via launchd: streams dump over SSH, atomic-swaps DB, rotates 7 backups
- **Wayback CDX recovery scraper** (Python) with URL classifier and resumable candidate queue
- **Auto-detection** of WordPress table prefix; views (not data duplication) bridge prefix differences
- **Index repair** post-mysql2sqlite (88× speedup on tag queries on the 1.2 GB PowerPage DB)
- **Comment-based engagement metrics** (counts, top discussed)
- **Demo banner** with one-click load when running on synthetic data

### v0.1 — initial release
- Dashboard with 4 stat cards + 4 recharts visualizations + recent posts
- SQL Explorer with WordPress table sidebar and live query runner
- Post Calendar: GitHub-style heatmap + 12-month grid
- Demo data auto-loads on mount
- Real `.sqlite` file loading via sql.js/WASM

---

## License

MIT
