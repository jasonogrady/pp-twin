# pp-twin

A local archive explorer for [O'Grady's PowerPage](https://www.powerpage.org) — a long-running Apple/Mac blog. Drop your WordPress SQLite export and get an instant dashboard, SQL explorer, and publication calendar.

![pp-twin dashboard](https://img.shields.io/badge/status-v0.1-gold) ![license](https://img.shields.io/badge/license-MIT-green)

---

## Features

| Tab | What it does |
|-----|-------------|
| **Dashboard** | Stat cards, monthly area chart, posts by year/author/category, recent posts feed |
| **SQL Explorer** | Table sidebar, live SQL editor (⌘↵ to run), paginated results table |
| **Post Calendar** | GitHub-style heatmap + 12-month grid — spots coverage gaps at a glance |

---

## Stack

- **React** — single JSX file, no build step
- **[sql.js](https://github.com/sql-js/sql.js)** `1.10.2` — in-browser SQLite via WebAssembly (loaded from cdnjs)
- **[recharts](https://recharts.org)** — AreaChart, BarChart
- Runs entirely in the browser; nothing leaves your machine

---

## Getting a SQLite export

### Option A — WP-CLI (recommended)
```zsh
wp db export dump.sql
sqlite3 powerpage.db < dump.sql
```

### Option B — SQLite Database Integration plugin
Install the [SQLite Database Integration](https://wordpress.org/plugins/sqlite-database-integration/) plugin. It writes a live `.sqlite` file to `wp-content/database/.ht.sqlite` — just grab that file.

---

## Running locally

pp-twin is a single self-contained JSX artifact designed to run inside [Claude.ai](https://claude.ai) artifacts. To run it standalone:

```zsh
# Quick dev server with Vite (no config needed)
npm create vite@latest pp-twin-dev -- --template react
cp pp-twin.jsx pp-twin-dev/src/App.jsx
cd pp-twin-dev
npm install recharts
npm run dev
```

Then open `http://localhost:5173` and drop your `.sqlite` file.

---

## WordPress schema

pp-twin expects a standard WordPress MySQL schema converted to SQLite. It auto-detects WordPress by checking for `wp_posts` + `wp_users` tables.

**Key queries used:**

```sql
-- Posts per day (drives the calendar heatmap)
SELECT date(post_date) day, COUNT(*) count
FROM wp_posts
WHERE post_status = 'publish' AND post_type = 'post'
GROUP BY day ORDER BY day;

-- Posts by author
SELECT u.display_name author, COUNT(*) count
FROM wp_posts p
JOIN wp_users u ON p.post_author = u.ID
WHERE p.post_status = 'publish' AND p.post_type = 'post'
GROUP BY p.post_author ORDER BY count DESC;

-- Posts by category
SELECT t.name cat, COUNT(*) count
FROM wp_posts p
JOIN wp_term_relationships tr ON p.ID = tr.object_id
JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
JOIN wp_terms t ON tt.term_id = t.term_id
WHERE tt.taxonomy = 'category'
  AND p.post_status = 'publish' AND p.post_type = 'post'
GROUP BY t.term_id ORDER BY count DESC;
```

---

## Demo mode

On load, pp-twin auto-generates 25 years of synthetic PowerPage-like data (2000–2024) using a deterministic LCG RNG (seed `0xdeadbeef`). Load a real `.sqlite` via the **📂 Load .sqlite** button in the header to replace it.

---

## Changelog

### v0.1 — initial release
- Dashboard with 4 stat cards + 4 recharts visualizations + recent posts
- SQL Explorer with WordPress table sidebar and live query runner
- Post Calendar: GitHub-style heatmap + 12-month grid with hover tooltips
- Demo data auto-loads on mount (no upload required)
- Real `.sqlite` file loading via sql.js/WASM

---

## License

MIT
