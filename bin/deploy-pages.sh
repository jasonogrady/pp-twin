#!/usr/bin/env zsh
# Build pp-twin-dev and deploy to Cloudflare Pages.
# First run creates the project; subsequent runs deploy new versions.
#
# Prereqs: `npm install -g wrangler` (or use npx) and `wrangler login` once.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR/pp-twin-dev"

echo "→ building pp-twin-dev/"
npm install --silent
npm run build

echo "→ deploying dist/ to Cloudflare Pages project 'pp-twin'"
cd "$PROJECT_DIR"
npx wrangler pages deploy pp-twin-dev/dist \
  --project-name pp-twin \
  --commit-dirty=true

echo
echo "✓ Deployed. URL printed above. Bookmark it."
