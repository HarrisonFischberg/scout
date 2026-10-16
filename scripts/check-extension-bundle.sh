#!/usr/bin/env bash
# Fails if a file from apple/Extension/Resources is missing from a built
# extension bundle. Usage: scripts/check-extension-bundle.sh <path-to-.appex>
set -euo pipefail
appex="$1"
res="$appex"
[ -d "$appex/Contents/Resources" ] && res="$appex/Contents/Resources"
missing=0
for f in apple/Extension/Resources/*; do
  name=$(basename "$f")
  if [ ! -e "$res/$name" ]; then echo "MISSING $name in $appex"; missing=1; fi
done
[ $missing -eq 0 ] && echo "bundle ok: $appex"
exit $missing
