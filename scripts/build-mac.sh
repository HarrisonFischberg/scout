#!/usr/bin/env bash
# Builds the extension and the macOS app, then registers it with Safari.
# Signs with your Apple Development certificate when one is in the Keychain,
# so Safari keeps the extension after it quits (no "Allow unsigned
# extensions" needed). Falls back to ad-hoc signing otherwise.
# Local signing only: nothing is sent to Apple, no provisioning profiles.
# Team: SCOUT_TEAM (default KTV2G3Z883, the team on the owner's Mac).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run --silent build
TEAM="${SCOUT_TEAM:-KTV2G3Z883}"
if security find-identity -v -p codesigning 2>/dev/null | grep -q '"Apple Development:'; then
  SIGN=(CODE_SIGN_IDENTITY="Apple Development" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$TEAM" PROVISIONING_PROFILE_SPECIFIER=)
  echo "signing: Apple Development (team $TEAM)"
else
  SIGN=(CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=)
  echo "signing: ad-hoc (Safari will need Allow unsigned extensions after each restart)"
fi
xcodebuild -project apple/SafariScout.xcodeproj -scheme "Scout for Safari (macOS)" -derivedDataPath build/DD "${SIGN[@]}" build 2>&1 | grep -E ' error:|BUILD'
scripts/check-extension-bundle.sh "build/DD/Build/Products/Debug/Scout for Safari.app/Contents/PlugIns/Scout for Safari Extension.appex"
scripts/register-mac-extension.sh "$@"
