# PowerPage archive recovery plan

The pp-twin Gaps tab quantifies what's missing from the live `powerpage.db`. This document is the playbook for filling those holes — what to try, in what order, and how to merge recovered posts back without corrupting the live archive.

## What's actually missing (as of 2026-05-24)

Per `gap_summary` and `gap_ranges`:

| Range | Weekday gaps | Notes |
|-------|------|-------|
| 1995-12-01 → 1999-01-29 | 826 (~3.2y) | Pre-WordPress era. Site was on a different CMS or hand-rolled HTML. |
| 1999-02-02 → 2001-07-16 | 640 (~2.5y) | Mostly missing. Also: **all 1,661 "1999" posts are stamped to a single date (1999-02-01)** — bodies likely fine, original timestamps lost during a migration. |
| 2007-09-06 → 2008-12-25 | 341 (~1.3y) | The "missing 2008" — likely a hosting outage, lost backup, or failed migration in this window. |
| 2003-09-05 → 2004-07-05 | 217 (~10mo) | Long 10-month dark window. |
| 2002-10-30 → 2002-11-05 | 5 | Small noise-level gap. |

Total recoverable surface: **~2,000 weekday-gap days** spread across these structural holes plus ~200 smaller weekday-level gaps inside otherwise-covered years.

## Recovery sources (rough yield order)

### 1. Wayback Machine — should cover ~70-80% of post-2001 gaps
The Internet Archive has crawled powerpage.org since 1999. Its CDX API lets you enumerate every snapshotted URL with its timestamp:

```
curl 'https://web.archive.org/cdx/search/cdx?url=powerpage.org/*&from=19990101&to=20010101&output=json&filter=statuscode:200&filter=mimetype:text/html&collapse=urlkey'
```

That returns a JSON array of `[urlkey, timestamp, original, mimetype, statuscode, digest, length]` tuples. Each unique `urlkey` is a candidate post URL; the earliest `timestamp` for it is when the post is likely to have appeared.

Workflow:
1. Pull CDX index for each gap range (one call per range).
2. Filter to URLs matching post patterns (e.g. `/YYYY/MM/DD/slug/`, `?p=NNN`, `/archives/NNN.html`, `/story.php?id=NNN` — depends on what CMS was running at the time).
3. For each candidate URL, fetch the earliest snapshot via `https://web.archive.org/web/TIMESTAMP/URL`.
4. Extract: title, body, author byline, publication date (parse from URL, page metadata, or visible "Posted on..." text).
5. Stage into `peq_posts_recovered` (a new table mirroring `peq_posts` schema, with extra columns `source`, `source_url`, `confidence`, `reviewed`).
6. Review queue in pp-twin: an admin tab that lets you scroll candidates and accept/reject/edit each. On accept, `INSERT INTO peq_posts SELECT ...` with `post_status='publish'` and rebuild the gap views.

### 2. Your own historical backups
Worth a thorough hunt before going to scraping:

- **cPanel Backup Wizard archives** — Bluehost retains daily/weekly backups for a few weeks but you may have downloaded older ones. Check Downloads, Documents, external drives.
- **MobileMe / iDisk dumps** — anyone with a `.mac` or `.me.com` account from 2000-2012 likely has a chunk of files in old backups. Apple migrated this content to iCloud Drive in 2012; check `~/Library/Mobile Documents/` and any pre-2012 Mac backups (Time Machine, SuperDuper).
- **WordPress XML exports** — search for `*.xml` or `*.wxr` in old backup drives. Even a partial export from 2010 would fill several years.
- **Old database dumps** — `*.sql`, `*.sql.gz`, `powerpage*` searches across all drives. Even a corrupted MySQL dump can usually be parsed for content.
- **Local WP install dev directories** — historical MAMP/XAMPP/Local environments often retain a full DB snapshot.

A 10-minute Spotlight search may save 100 hours of scraping. Recommended commands:

```bash
mdfind 'kMDItemDisplayName == "*powerpage*"'
mdfind 'kMDItemContentType == public.archive && kMDItemDisplayName == "*pp*"'
mdfind 'kMDItemTextContent == "powerpage" && kMDItemContentType == "public.html"'
find /Volumes -iname '*powerpage*' -o -iname '*pp_posts*' 2>/dev/null
```

### 3. Pre-WordPress content (1995-1999, 2000)
PowerPage existed before WordPress was created (WP debuted 2003). The 1995-1998 era ran on a different CMS or static HTML. Specific things to track down:

- **Original platform**: was it Frontier Manila, Movable Type, Greymatter, or hand-edited HTML? Knowing this narrows where backups would live.
- **GeoCities mirror?** PowerPage's earliest URL may have been hosted on GeoCities, EarthLink, or AOL Members — these all had separate archives at archive.org.
- **Old EditThisPage / Manila sites** (Userland Software) — Manila powered many Apple-blog-era sites; if PP was on it, the original Manila database may exist on Userland's surviving Frontier archives.
- **Personal email archives** — search Gmail/Apple Mail/Outlook backups for the keyword "powerpage" in 1995-2000 messages. Editors often emailed each other drafts, which preserves headlines + bodies + dates.

### 4. Other contributors
The dump shows 11 distinct authors. Reach out to ones with substantial post counts:

- **Connie Guglielmo** — second-largest contributor by historical count. May have personal copies of her PP pieces in email archives or notes.
- **Staff writers** from the 2000s — anyone who freelanced may still have submitted-draft copies.

A simple email request: "I'm reconstructing the PP archive — do you have copies of any pieces you wrote for us between [year] and [year]?"

### 5. Sites that linked to you
Old Apple-blog ecosystem sites preserved your URLs + dates + excerpts in their own posts. These are *secondary* sources but they confirm dates and headlines exist:

- **MacFixIt** (acquired by CNET in 2007, may have legacy archives)
- **MacRumors** — has searchable forum archives going back to 2000
- **Daring Fireball** (Gruber, started 2002)
- **TUAW / The Unofficial Apple Weblog** (defunct, Wayback-only)
- **AppleInsider** forum threads
- **Slashdot** — Apple section indexed PP frequently
- **Digg** archive (defunct, but pre-2010 dumps exist via archive.org)

A targeted Wayback search:
```
curl 'https://web.archive.org/cdx/search/cdx?url=daringfireball.net/*&filter=mimetype:text/html&matchType=domain' \
  | xargs ... grep "powerpage.org"
```

### 6. Google Groups / mailing lists
`comp.sys.mac.advocacy`, `comp.sys.mac.system`, and Apple-related Yahoo Groups frequently quoted PowerPage stories. Google Groups (now in archived form) searchable for "powerpage.org/articleNumber" patterns.

### 7. Print syndication
If any PP pieces ran in MacWorld, MacLife, MacAddict, or PC Magazine columns (they did, occasionally) — the publishers' digital archives or print runs are authoritative dated sources.

## Staging table design

To avoid corrupting the live `peq_posts` table:

```sql
CREATE TABLE peq_posts_recovered (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposed_post_date DATETIME,    -- our best guess at original publication
  proposed_post_title TEXT,
  proposed_post_content TEXT,
  proposed_post_author TEXT,       -- string, resolved to wp_users.ID at merge time
  source TEXT,                     -- 'wayback' | 'email' | 'contributor:NAME' | 'syndicated' etc.
  source_url TEXT,                 -- direct link to evidence
  source_snapshot_ts TEXT,         -- ISO timestamp of the Wayback snapshot used
  confidence REAL,                 -- 0.0 - 1.0, our certainty in dates/content
  reviewed INTEGER DEFAULT 0,      -- 0=pending, 1=accepted, -1=rejected
  reviewer_notes TEXT,
  merged_into_post_id INTEGER,     -- once merged into peq_posts, the wp_posts.ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_recovered_date     ON peq_posts_recovered(proposed_post_date);
CREATE INDEX idx_recovered_reviewed ON peq_posts_recovered(reviewed);
```

Merge workflow on accept:
```sql
INSERT INTO peq_posts (post_date, post_date_gmt, post_title, post_content, post_author, post_status, post_type)
  SELECT proposed_post_date, proposed_post_date, proposed_post_title, proposed_post_content,
         (SELECT ID FROM peq_users WHERE display_name = proposed_post_author LIMIT 1),
         'publish', 'post'
  FROM peq_posts_recovered
  WHERE id = ? AND reviewed = 1;
UPDATE peq_posts_recovered SET merged_into_post_id = last_insert_rowid() WHERE id = ?;
```

After a merge batch, run `sqlite3 powerpage.db < sql/gap-views.sql` to refresh the gap views.

## Recommended phasing

1. **Day 1 (hours)** — exhaust source #2 (your own backups). Highest yield per minute spent.
2. **Day 2 (1-2 days)** — write the Wayback CDX scraper. Run it overnight against the 4 major gap ranges.
3. **Day 3-4** — build the review queue in pp-twin (new "Recovery" tab) and review the staged candidates.
4. **Week 2+** — emails to contributors, dig into pre-WP era via Manila/Frontier archives.
5. **Last resort** — secondary-source date confirmation via #5 (sites that linked you). Useful when bodies are unrecoverable but headlines/dates are.

## What I can build for you next

- `bin/wayback-recover.py` — CDX enumeration + snapshot fetch + body extraction → stages rows into `peq_posts_recovered`.
- New "Recovery" tab in pp-twin showing the review queue: candidate post preview, source URL link, accept/reject/edit controls.
- A "find local backups" launchd-on-demand script that runs the `mdfind` searches above and reports candidate files.

Tell me which to build first.
