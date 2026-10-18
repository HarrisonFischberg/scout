#!/usr/bin/env bash
# Builds the release extension and fails if any debug diagnostics code or
# markup is left in it. Rebuilds the debug bundle afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run --silent build:release
bad=0
for s in "Scout for Safari diagnostics" "debug.stage" "Copy diagnostics" "diag-copy" "probe start" "drag: "; do
  if grep -q "$s" apple/Extension/Resources/popup.js; then echo "release popup.js contains: $s"; bad=1; fi
done
if grep -q 'id="diag"\|debug:start\|diag-mock' apple/Extension/Resources/popup.html; then echo "release popup.html contains diagnostics markup"; bad=1; fi
# Part 2: the local mock server switch exists only in debug builds.
for f in popup.js background.js; do
  if grep -q "devMockServer\|127.0.0.1:4318" "apple/Extension/Resources/$f"; then echo "release $f contains the mock server switch"; bad=1; fi
done
npm run --silent build
[ $bad -eq 0 ] && echo "release bundle clean"
exit $bad
