#!/bin/zsh
# Weekly update of the atlas (option A: runs on the owner's Mac).
# 1. discover candidates (no AI) and read submitted results (GitHub issues), 2. copy the repository to a work copy,
# 3. let Claude Code read, verify and place the new papers there,
# 4. check, build, and write a patch and a report for the owner to review.
# Nothing is committed or pushed. Usage: zsh scripts/weekly.sh [--days N] [--no-agent]
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WEEKLY_WORK:-$REPO/../mobility-matters-weekly}"
DAY="$(date +%F)"
OUT="$REPO/updates/$DAY"
LOG="$OUT/run.log"
mkdir -p "$OUT"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
exec > >(tee -a "$LOG") 2>&1
echo "== weekly update $DAY"

ARGS=(); AGENT=1
for a in "$@"; do [ "$a" = "--no-agent" ] && AGENT=0 || ARGS+=("$a"); done

python3 "$REPO/scripts/discover.py" "${ARGS[@]}" || { echo "discovery failed"; exit 1; }
N=$(python3 -c "import json;print(len(json.load(open('$OUT/candidates.json'))['candidates']))")
# readers' submissions: open issues labelled new-result or error (needs the GitHub CLI, logged in)
if command -v gh >/dev/null; then
  gh issue list -R drdebmath/mobility-matters --state open --label new-result --limit 50 --json number,title,body,author,url,createdAt,labels > "$OUT/issues-new.json" 2>/dev/null || echo "[]" > "$OUT/issues-new.json"
  gh issue list -R drdebmath/mobility-matters --state open --label error --limit 50 --json number,title,body,author,url,createdAt,labels > "$OUT/issues-err.json" 2>/dev/null || echo "[]" > "$OUT/issues-err.json"
  python3 -c "import json;a=json.load(open('$OUT/issues-new.json'))+json.load(open('$OUT/issues-err.json'));json.dump(a,open('$OUT/issues.json','w'),indent=2);print('issues:',len(a))"
  rm -f "$OUT/issues-new.json" "$OUT/issues-err.json"
fi
NI=$(python3 -c "import json,os;p='$OUT/issues.json';print(len(json.load(open(p))) if os.path.exists(p) else 0)")
echo "candidates: $N"
echo "submitted issues: $NI"

# a fresh work copy of the site (papers/ is shared, not copied)
mkdir -p "$WORK"
rsync -a --delete --exclude '.git' --exclude 'papers' --exclude 'build' --exclude 'updates/*/run.json' "$REPO/" "$WORK/"

if [ "$AGENT" = 1 ] && [ "$N" -gt 0 -o "$NI" -gt 0 -o -n "$(ls "$REPO/updates/inbox" 2>/dev/null)" ]; then
  cd "$WORK"
  claude -p "$(cat "$REPO/scripts/weekly-update.md")" \
    --add-dir "$REPO/papers" \
    --permission-mode acceptEdits \
    --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "WebFetch" "WebSearch" \
      "Bash(python3:*)" "Bash(node:*)" "Bash(pdftotext:*)" "Bash(pdftoppm:*)" "Bash(curl:*)" \
      "Bash(ls:*)" "Bash(mkdir:*)" "Bash(cp:*)" "Bash(mv:*)" "Bash(grep:*)" "Bash(head:*)" "Bash(wc:*)" \
    --disallowedTools "Bash(git:*)" "Bash(rm:*)" \
    --output-format json > "$OUT/run.json"
  RC=$?
  echo "agent exit: $RC"
  [ "$RC" = 0 ] && python3 "$REPO/scripts/discover.py" --record "$OUT/candidates.json"
  [ -f "$WORK/updates/$DAY/REPORT.md" ] && cp "$WORK/updates/$DAY/REPORT.md" "$OUT/REPORT.md"
  python3 scripts/validate.py | tail -1
  node scripts/render-check.js 2>&1 | tail -1
  python3 scripts/build-pdf.py 2>&1 | tail -1
fi

# the proposed changes as one patch against the owner's copy
cd "$REPO/.."
diff -ruN --exclude papers --exclude build --exclude updates --exclude '.git' --exclude '.DS_Store' \
  "$(basename "$REPO")" "$(basename "$WORK")" > "$OUT/changes.patch"
echo "patch: $(grep -c '^+++ ' "$OUT/changes.patch") files changed -> $OUT/changes.patch"
osascript -e "display notification \"$N candidates, $NI submitted; report in updates/$DAY\" with title \"Mobility Matters weekly update\"" 2>/dev/null
echo "== done. Review: $OUT/REPORT.md and $OUT/changes.patch"
echo "   Apply: cd $REPO && patch -p1 < $OUT/changes.patch   (or copy files from $WORK)"
