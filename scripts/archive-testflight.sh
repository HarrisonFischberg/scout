#!/usr/bin/env bash
# Archives the Release build for macOS and iOS and uploads both to App Store
# Connect for TestFlight (docs/testflight.md). Run on the owner's Mac, with
# Xcode signed in to the Apple ID of team KTV2G3Z883 (Xcode > Settings >
# Accounts) and the App Store Connect record for com.harrisonfischberg.SafariScout
# already created. Uploads go to Apple: owner's approval only.
# Build number: SCOUT_BUILD_NUMBER, default a timestamp, so every upload is higher.
# SCOUT_PLATFORMS="macOS iOS" (default both) picks platforms; --no-upload
# stops after the archive.
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD="${SCOUT_BUILD_NUMBER:-$(date -u +%Y%m%d.%H%M)}"
UPLOAD=1; [ "${1:-}" = "--no-upload" ] && UPLOAD=0
# check:release leaves the debug bundle in place, so build the release
# extension (no diagnostics code) last, and put the debug one back on exit.
npm run --silent check:release
npm run --silent build:release
trap 'npm run --silent build' EXIT
for platform in ${SCOUT_PLATFORMS:-macOS iOS}; do
  case "$platform" in
    macOS) dest='generic/platform=macOS' ;;
    iOS) dest='generic/platform=iOS' ;;
    *) echo "unknown platform $platform" >&2; exit 1 ;;
  esac
  archive="build/archives/Scout-$platform-$BUILD.xcarchive"
  echo "archiving $platform build $BUILD"
  xcodebuild -project apple/SafariScout.xcodeproj -scheme "Scout for Safari ($platform)" \
    -configuration Release -destination "$dest" -archivePath "$archive" \
    -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" archive 2>&1 | grep -E ' error:|ARCHIVE'
  if [ "$UPLOAD" = 1 ]; then
    echo "uploading $platform build $BUILD"
    xcodebuild -exportArchive -archivePath "$archive" -exportPath "build/archives/export-$platform-$BUILD" \
      -exportOptionsPlist scripts/ExportOptions-testflight.plist -allowProvisioningUpdates 2>&1 | grep -E ' error:|EXPORT|Upload'
  fi
done
