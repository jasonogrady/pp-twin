#!/usr/bin/env zsh
# pp-twin — create GitHub repo and push v0.1
# Usage: GH_USER=yourname GH_TOKEN=ghp_xxx zsh setup-github.zsh

set -e

GH_USER=${GH_USER:?"Set GH_USER to your GitHub username"}
GH_TOKEN=${GH_TOKEN:?"Set GH_TOKEN to a GitHub personal access token (needs repo scope)"}
REPO="pp-twin"

echo "▶ Creating GitHub repo ${GH_USER}/${REPO}..."
curl -sf -X POST \
  -H "Authorization: token ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user/repos \
  -d "{
    \"name\": \"${REPO}\",
    \"description\": \"Local archive explorer for O'Grady's PowerPage — dashboard, SQL explorer, and publication calendar\",
    \"private\": false,
    \"auto_init\": false
  }" | grep -q '"full_name"' && echo "  ✓ Repo created" || echo "  ✓ Repo may already exist, continuing..."

echo "▶ Initialising local git repo..."
git init -b main
git config user.email "${GH_USER}@users.noreply.github.com"
git config user.name "${GH_USER}"

git add README.md pp-twin.jsx .gitignore
git commit -m "feat: initial release — dashboard, SQL explorer, post calendar

- Dashboard: stat cards, monthly area chart, by-year/author/category bars, recent posts
- SQL Explorer: WordPress table sidebar, live query runner (⌘↵), results table
- Post Calendar: GitHub-style heatmap + 12-month grid, year navigation, hover tooltips
- Demo mode: deterministic 2000–2024 synthetic data loads on mount
- Real data: drop any WordPress SQLite export via 📂 Load .sqlite"

git tag -a v0.1 -m "v0.1 — initial release"

echo "▶ Pushing to GitHub..."
git remote add origin "https://${GH_TOKEN}@github.com/${GH_USER}/${REPO}.git"
git push -u origin main
git push origin v0.1

echo ""
echo "✅ Done: https://github.com/${GH_USER}/${REPO}"
echo "   Release: https://github.com/${GH_USER}/${REPO}/releases/tag/v0.1"
