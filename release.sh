#!/usr/bin/env bash
# One command for every store Scout ships to (release/README.md).
#   ./release.sh [ios|mac|chrome|firefox|all] [--beta] [--live]
# Dry run by default: builds and checks everything, uploads nothing. --live
# publishes. --beta sends iOS/Mac to TestFlight instead of App Review.
# Secrets come only from environment variables; none are stored in the repo.
set -euo pipefail
cd "$(dirname "$0")"
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 # fastlane needs a UTF-8 locale
TARGET="${1:-all}"; shift || true
LIVE=false; LANE=release
for arg in "$@"; do
  case "$arg" in
    --live) LIVE=true ;;
    --beta) LANE=beta ;;
    *) echo "unknown option $arg" >&2; exit 1 ;;
  esac
done
need() { for v in "$@"; do [ -n "${!v:-}" ] || { echo "missing env var $v (release/README.md)" >&2; exit 1; }; done; }
VERSION=$(node -p 'require("./src/manifest.json").version')

apple() { # $1 = ios or mac
  need ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH
  fastlane "$1" "$LANE" live:"$LIVE"
}

chrome() {
  npm run --silent build:chrome
  local zip="dist/scout-chrome-$VERSION.zip"
  if [ "$LIVE" = true ]; then
    need CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN CWS_EXTENSION_ID CWS_PUBLISHER_ID
    # No command = upload, then publish.
    CLIENT_ID="$CWS_CLIENT_ID" CLIENT_SECRET="$CWS_CLIENT_SECRET" REFRESH_TOKEN="$CWS_REFRESH_TOKEN" \
      npx --yes chrome-webstore-upload-cli@4.0.2 --source "$zip" \
      --extension-id "$CWS_EXTENSION_ID" --publisher-id "$CWS_PUBLISHER_ID"
  else
    echo "dry run: would upload and publish $zip to the Chrome Web Store"
  fi
}

firefox() {
  npm run --silent build:firefox
  npx --yes web-ext@10.8.0 lint --source-dir dist/firefox
  # AMO asks for source because the code is bundled; this zip rebuilds it.
  local src="dist/scout-firefox-$VERSION-source.zip"
  git archive --format=zip -o "$src" HEAD
  if [ "$LIVE" = true ]; then
    need AMO_JWT_ISSUER AMO_JWT_SECRET
    # Key and secret go in through web-ext's own env vars, not the command
    # line, so they never show in `ps` or shell history.
    WEB_EXT_API_KEY="$AMO_JWT_ISSUER" WEB_EXT_API_SECRET="$AMO_JWT_SECRET" \
      npx --yes web-ext@10.8.0 sign --source-dir dist/firefox --channel listed \
      --amo-metadata store/firefox/amo-metadata.json --upload-source-code "$src" --artifacts-dir dist
  else
    echo "dry run: would submit dist/firefox (version $VERSION) and $src to Firefox Add-ons"
  fi
}

case "$TARGET" in
  ios|mac) apple "$TARGET" ;;
  chrome) chrome ;;
  firefox) firefox ;;
  android) echo "Scout has no Android app (Firefox for Android installs the Firefox add-on)."; exit 1 ;;
  all)
    # Same TestFlight version (0.N) on both Apple platforms.
    export SCOUT_VERSION_NUMBER="${SCOUT_VERSION_NUMBER:-$(( $(cat ~/.scout-testflight-number 2>/dev/null || echo 1) + 1 ))}"
    apple ios; apple mac; chrome; firefox ;;
  *) echo "usage: ./release.sh [ios|mac|chrome|firefox|all] [--beta] [--live]" >&2; exit 1 ;;
esac
