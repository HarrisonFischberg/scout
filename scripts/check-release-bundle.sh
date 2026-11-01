#!/usr/bin/env bash
# Builds the release extension and fails if any debug-only code or markup is
# left in it. The debug log itself (src/diagnostics.ts, Copy debug log) ships
# in every build since 2026-10-24 (owner decision); the native console log,
# the drag probe and the mock server switch stay debug only. Rebuilds the debug bundle afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run --silent build:release
bad=0
for s in "Scout for Safari diagnostics" "debug.stage" "probe start" "drag: "; do
  if grep -q "$s" apple/Extension/Resources/popup.js; then echo "release popup.js contains: $s"; bad=1; fi
done
if grep -q 'debug:start\|diag-mock' apple/Extension/Resources/popup.html; then echo "release popup.html contains debug-only markup"; bad=1; fi
# The debug log does ship: TestFlight builds must be able to copy it.
if ! grep -q 'diag-menu-copy' apple/Extension/Resources/popup.html; then echo "release popup.html is missing Copy debug log"; bad=1; fi
# Part 2: the local mock server switch exists only in debug builds.
for f in popup.js background.js; do
  if grep -q "devMockServer\|127.0.0.1:4318" "apple/Extension/Resources/$f"; then echo "release $f contains the mock server switch"; bad=1; fi
done
# Safari keeps API keys in the Keychain only. The Chrome/Firefox key storage
# (createStorageSend in src/keychain.ts) must be compiled out of Safari bundles.
for f in popup.js background.js; do
  if grep -q '"apiKey:"' "apple/Extension/Resources/$f"; then echo "release $f contains the browser key storage"; bad=1; fi
done
# The app's own chat (src/app/chat.ts) reads the key from the Keychain bridge
# only; its stand-in key for tests outside the app is debug only.
if grep -q "scout.app.devKey" apple/App/Chat/app-chat.js; then echo "release app-chat.js contains the stand-in key storage"; bad=1; fi
npm run --silent build
[ $bad -eq 0 ] && echo "release bundle clean"
exit $bad
