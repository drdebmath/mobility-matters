#!/usr/bin/env bash
# Assemble the deployed site in OUTDIR (default build/site): the repository's static files, plus
# llms.txt, llms-full.txt, a prerendered crawlable page per route and the full sitemap.xml.
# The GitHub Pages workflow (.github/workflows/pages.yml) runs this on every push to main;
# run it locally to preview: bash scripts/build-site.sh && python3 -m http.server 8765 -d build/site
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-build/site}"
rm -rf "$OUT"
mkdir -p "$OUT"
rsync -a --exclude '.git' --exclude '.github' --exclude 'build' --exclude 'updates' --exclude 'papers' \
  --exclude 'scripts/.cache' --exclude 'data/decisions.json' --exclude '.DS_Store' --exclude '__pycache__' ./ "$OUT/"
python3 scripts/build-llms.py "$OUT"
node scripts/prerender.js "$OUT"
