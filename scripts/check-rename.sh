#!/usr/bin/env bash
# Rename check (spec Part 1): fails if the old name "AssistAnt", in any
# spelling, or the old ant artwork is still referenced. Scans files git tracks
# or would track (gitignored logs and build output are skipped). Allowed on
# purpose: the English word "assistant" (also the API message role), the
# "sk-ant-" prefix of Anthropic API keys, and activity.md, the append-only
# history log.
set -uo pipefail
cd "$(dirname "$0")/.."
files=()
while IFS= read -r -d '' f; do
  # History logs and recorded live-suite pages (third-party text) are skipped.
  case "$f" in activity.md | docs/final-report.md | scripts/check-rename.sh | ralph/evidence/*) continue ;; esac
  [ -f "$f" ] && files+=("$f")
done < <(git ls-files -z -co --exclude-standard)
hits=$(
  {
    grep -nIH -E "AssistAnt|Assist[ _-]?Ant|[Aa]ssist[-_]ant|ASSIST_?ANT" "${files[@]}"
    grep -nIH -iwE "ant" "${files[@]}" | grep -v "sk-ant"
    grep -nIH -iE "\bant[-.](png|svg|icns|toolbar|icon|appicon)" "${files[@]}"
  } | sort -u
)
if [ -n "$hits" ]; then
  echo "$hits"
  echo "rename check: old name found"
  exit 1
fi
# Second rename (owner 2026-10-19): "Scout for Safari" is now "Scout AI
# Assistant" everywhere people read it: the extension, the app's own text,
# Info.plist names and the legal drafts. Internal names keep it on purpose
# (Xcode targets, schemes, PRODUCT_NAME, bundle IDs): changing those loses
# saved keys and breaks the Mac and iPhone build scripts.
shown=$(git ls-files -co --exclude-standard -- src apple/App apple/Extension/Info.plist apple/UITests docs/legal/privacy-policy.md docs/legal/terms.md |
  xargs -d '\n' grep -nIH "Scout for Safari" 2>/dev/null)
if [ -n "$shown" ]; then
  echo "$shown"
  echo "rename check: \"Scout for Safari\" still shown to people"
  exit 1
fi
echo "rename check: clean (${#files[@]} files)"
