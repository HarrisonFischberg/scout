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
  case "$f" in activity.md | scripts/check-rename.sh) continue ;; esac
  [ -f "$f" ] && files+=("$f")
done < <(git ls-files -z -co --exclude-standard)
hits=$(
  {
    grep -nIH -E "AssistAnt|Assist[ _-]?Ant|[Aa]ssist[-_]ant|ASSIST_?ANT" "${files[@]}"
    grep -nIH -iwE "ant" "${files[@]}" | grep -v "sk-ant-"
    grep -nIH -iE "\bant[-.](png|svg|icns|toolbar|icon|appicon)" "${files[@]}"
  } | sort -u
)
if [ -n "$hits" ]; then
  echo "$hits"
  echo "rename check: old name found"
  exit 1
fi
echo "rename check: clean (${#files[@]} files)"
