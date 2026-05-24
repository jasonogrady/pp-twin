-- pp-twin gap analysis views
-- Defines: gap_days, gap_ranges, gap_summary
-- Anchor: PowerPage began publishing 1995-12-01

DROP VIEW IF EXISTS gap_days;
DROP VIEW IF EXISTS gap_ranges;
DROP VIEW IF EXISTS gap_summary;

-- All weekdays (Mon-Fri) from 1995-12-01 to today with the actual post count for that day.
-- A "gap" is any weekday with post_count = 0.
CREATE VIEW gap_days AS
WITH RECURSIVE
  series(d) AS (
    SELECT date('1995-12-01')
    UNION ALL
    SELECT date(d, '+1 day') FROM series WHERE d < date('now')
  ),
  weekdays AS (
    SELECT d FROM series WHERE strftime('%w', d) NOT IN ('0','6')
  ),
  posts_by_day AS (
    SELECT date(post_date) day, COUNT(*) n
    FROM wp_posts
    WHERE post_status='publish' AND post_type='post'
    GROUP BY day
  )
SELECT w.d AS day,
       strftime('%Y', w.d) AS year,
       strftime('%m', w.d) AS month,
       CASE strftime('%w', w.d)
         WHEN '1' THEN 'Mon' WHEN '2' THEN 'Tue' WHEN '3' THEN 'Wed'
         WHEN '4' THEN 'Thu' WHEN '5' THEN 'Fri'
       END AS weekday,
       COALESCE(p.n, 0) AS posts
FROM weekdays w
LEFT JOIN posts_by_day p ON p.day = w.d
WHERE COALESCE(p.n, 0) = 0
ORDER BY w.d;

-- Contiguous runs of gap weekdays. Weekends do NOT break a run (we don't expect weekend posts).
-- Uses double row_number: rn_global counts within all weekdays, rn_gap counts within gap weekdays only.
-- The difference is constant across consecutive gap weekdays even when weekends sit between them.
CREATE VIEW gap_ranges AS
WITH RECURSIVE
  series(d) AS (
    SELECT date('1995-12-01')
    UNION ALL
    SELECT date(d, '+1 day') FROM series WHERE d < date('now')
  ),
  weekdays AS (
    SELECT d, ROW_NUMBER() OVER (ORDER BY d) AS rn_global
    FROM series WHERE strftime('%w', d) NOT IN ('0','6')
  ),
  posts_by_day AS (
    SELECT date(post_date) day, COUNT(*) n
    FROM wp_posts WHERE post_status='publish' AND post_type='post'
    GROUP BY day
  ),
  numbered_gaps AS (
    SELECT w.d AS day,
           w.rn_global - ROW_NUMBER() OVER (ORDER BY w.d) AS grp
    FROM weekdays w
    LEFT JOIN posts_by_day p ON p.day = w.d
    WHERE COALESCE(p.n, 0) = 0
  )
SELECT MIN(day) AS start_day,
       MAX(day) AS end_day,
       COUNT(*) AS weekday_count,
       CAST(julianday(MAX(day)) - julianday(MIN(day)) + 1 AS INTEGER) AS span_days
FROM numbered_gaps
GROUP BY grp
ORDER BY weekday_count DESC, start_day;

-- Per-year coverage rollup. expected_weekdays = Mon-Fri in that year that have already occurred.
CREATE VIEW gap_summary AS
WITH RECURSIVE
  series(d) AS (
    SELECT date('1995-12-01')
    UNION ALL
    SELECT date(d, '+1 day') FROM series WHERE d < date('now')
  ),
  weekdays_per_year AS (
    SELECT strftime('%Y', d) AS year, COUNT(*) AS weekdays
    FROM series
    WHERE strftime('%w', d) NOT IN ('0','6')
    GROUP BY year
  ),
  posts_per_year AS (
    SELECT strftime('%Y', post_date) AS year, COUNT(*) AS posts
    FROM wp_posts
    WHERE post_status='publish' AND post_type='post'
    GROUP BY year
  ),
  gaps_per_year AS (
    SELECT year, COUNT(*) AS gap_weekdays FROM gap_days GROUP BY year
  )
SELECT w.year,
       COALESCE(p.posts, 0)            AS posts,
       w.weekdays                       AS expected_weekdays,
       COALESCE(g.gap_weekdays, 0)      AS gap_weekdays,
       w.weekdays - COALESCE(g.gap_weekdays, 0) AS covered_weekdays,
       ROUND(100.0 * (w.weekdays - COALESCE(g.gap_weekdays, 0)) / w.weekdays, 1) AS coverage_pct
FROM weekdays_per_year w
LEFT JOIN posts_per_year p ON p.year = w.year
LEFT JOIN gaps_per_year  g ON g.year = w.year
ORDER BY w.year;
