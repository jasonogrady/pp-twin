# Hunter recovery — Mac mini handoff

Goal: recover **all** of O'Grady's PowerPage's missing articles from the Wayback Machine
and get their full text into `powerpage.db`. This doc hands the long-running half of that
job to the **Mac mini**, which stays awake (the MacBook sleeps with the lid closed).

## The two halves of the pipeline

| | Where | What | Cadence |
|---|---|---|---|
| **Cloud Hunter** | GitHub Actions (`.github/workflows/hunter.yml`) | Discovers candidates via Wayback CDX + fetches **metadata only** (`--no-body`) into the committed `recovery/hunter.db`. Powers the mobile Hunter tab. | every 2h, 24/7 |
| **Local body-fetch** | **Mac mini** (`bin/hunter-local-recover.sh`) | Fetches the actual **article bodies** into the local 1.2 GB `powerpage.db`. | persistent daemon |

Discovery is essentially complete (~4,970 candidates). The remaining work is **draining the
pending queue into full-text recovered posts** — that's what the Mac mini daemon does.

### Why it's a slow drip, not one big run
`web.archive.org`'s **playback** host TCP-refuses (connection-refused, not HTTP 429) after
~35 requests in a burst — far stricter than the CDX/availability API. So the daemon fetches a
small batch (default 20, 4s apart), then cools down (default 6 min), keeping the average rate
low enough to avoid the block. Every fetched candidate is marked `fetched` in `powerpage.db`,
so a kill/reboot just resumes — nothing is lost. At the defaults it drains the ~4,600 pending
candidates over roughly a week; the cloud cron keeps discovering in parallel.

### ⚠️ Run on ONE machine only
`powerpage.db` lives in iCloud Drive (`~/Library/Mobile Documents/.../GitHub/pp-twin`). Two
machines writing it would create iCloud conflict copies. **Run the recover daemon on the Mac
mini only.** If the MacBook ever ran it, uninstall there first:
`bin/install-launchd.sh uninstall recover`.

## One-time setup on the Mac mini

1. **Confirm the repo is present** (it syncs via iCloud):
   ```bash
   cd "$HOME/Library/Mobile Documents/com~apple~CloudDocs/GitHub/pp-twin"
   git pull            # get the latest scripts
   ```

2. **Confirm `powerpage.db` is materialized** (not an iCloud "dataless" placeholder):
   ```bash
   ls -lh powerpage.db          # should be ~1.2 GB, not a few KB
   # if it's a placeholder, force download:
   # brctl download powerpage.db   # (or open the folder in Finder to trigger sync)
   ```
   If it's missing entirely, sync it from Bluehost: `bin/sync-from-bluehost.sh`
   (needs `.env` — copy `.env.example` and fill in `BLUEHOST_HOST` / `BLUEHOST_USER`).

3. **Create the Python venv** (one time):
   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

4. **Sanity-check the daemon** before installing it:
   ```bash
   bin/hunter-local-recover.sh --status        # queue counts + recovered-by-year
   PP_BATCH=3 bin/hunter-local-recover.sh --once # fetch 3 bodies, confirm "✓ … " lines
   ```

## Start the persistent daemon

```bash
bin/install-launchd.sh install recover
```
This installs `~/Library/LaunchAgents/ai.ogrady.pptwin-recover.plist` with `RunAtLoad` +
`KeepAlive`, so launchd starts it now, after every reboot, and restarts it if it ever exits.

The daemon **self-heals on startup** (`--requeue-bodyless`): any candidate the cloud fetched
metadata-only is reset to `pending` so its body gets fetched locally.

## Monitoring & control

```bash
bin/install-launchd.sh status recover     # launchd state
tail -f /tmp/pptwin-recover.out           # live progress (batches, ✓ fetched lines)
tail -f /tmp/pptwin-recover.err           # ⏸ Wayback blocks land here
bin/hunter-local-recover.sh --status      # queue + recovered-by-year snapshot
bin/install-launchd.sh run-now  recover   # kick a restart
bin/install-launchd.sh uninstall recover  # stop & remove
```

### Tuning (env vars in the plist, or shell)
- `PP_BATCH` (20) — candidates per batch.
- `PP_DELAY` (4) — seconds between requests in a batch.
- `PP_COOLDOWN` (360) — seconds between batches. **Raise this** if `/tmp/pptwin-recover.err`
  shows repeated `⏸ blocked` lines.
- `PP_MIN_CONF` (0.7) — minimum candidate confidence to fetch.

After editing the plist's `EnvironmentVariables`, re-run `bin/install-launchd.sh install recover`.

## Pulling in newly discovered candidates

The cloud cron keeps finding candidates and committing `recovery/hunter.db`. To import them
into the Mac mini's `powerpage.db` so the daemon fetches their bodies, periodically run:
```bash
bin/hunter-merge-local.sh        # git pull + import NEW candidates as 'pending'
```
The merge imports candidates as `pending` (never inheriting the cloud's `fetched` status), so
it can't starve the body-fetcher. Safe to run anytime; idempotent.

## Priority order

The daemon fetches the gap years first — **2008 (only 2 posts in the live blog!)**, then
2007→2003 — before a catch-all pass that mops up everything else, including the pre-2002 /
year-2000 candidates that have no inferred date. Edit `PRIORITY_WINDOWS` in
`bin/hunter-local-recover.sh` to reorder.

## What's still NOT built (the last mile)

Recovered articles land in `powerpage.db`'s `peq_posts_recovered` table with full bodies, but
**nothing promotes them into actual published posts** (`peq_posts`). `hunter-merge-local.sh`
only syncs the recovery *tables*; there is no accept→merge step yet. Reviewing/accepting and
inserting confirmed articles into the live post table is the remaining work toward "all my
missing articles are restored." Review candidates in the pp-twin **Hunter** tab first.
