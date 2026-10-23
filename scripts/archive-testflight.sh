#!/usr/bin/env bash
# Archives the Release build for macOS and iOS and uploads both to App Store
# Connect for TestFlight (docs/testflight.md). Run on the owner's Mac, with
# Xcode signed in to the Apple ID of team KTV2G3Z883 (Xcode > Settings >
# Accounts) and the App Store Connect record for com.harrisonfischberg.Scoutai
# already created. Uploads go to Apple: owner's approval only.
# Build number: SCOUT_BUILD_NUMBER, default a timestamp, so every upload is higher.
# SCOUT_PLATFORMS="macOS iOS" (default both) picks platforms; --no-upload
# stops after the archive.
# On exit it unregisters the Release copies the archive leaves behind (in
# DerivedData's ArchiveIntermediates, the .xcarchive and the export folder):
# LaunchServices picks them up and Safari then shows that copy (blank icon,
# not working) instead of the dev build. It then re-registers the dev build
# from scripts/build-mac.sh when there is one.
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD="${SCOUT_BUILD_NUMBER:-$(date -u +%Y%m%d.%H%M)}"
UPLOAD=1; [ "${1:-}" = "--no-upload" ] && UPLOAD=0
# check:release leaves the debug bundle in place, so build the release
# extension (no diagnostics code) last, and put the debug one back on exit.
npm run --silent check:release
npm run --silent build:release
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
restore_dev_build() {
  npm run --silent build || true
  [ "$(uname)" = Darwin ] || return 0
  shopt -s nullglob
  local dd="$HOME/Library/Developer/Xcode/DerivedData"
  for app in "$dd"/SafariScout-*/Build/Intermediates.noindex/ArchiveIntermediates/*/{InstallationBuildProductsLocation/Applications,BuildProductsPath/*}/*.app \
             build/archives/*.xcarchive/Products/Applications/*.app build/archives/export-*/*.app; do
    for appex in "$app"/Contents/PlugIns/*.appex "$app"/PlugIns/*.appex; do
      pluginkit -r "$appex" 2>/dev/null || true
      "$LSR" -u "$appex" 2>/dev/null || true
    done
    "$LSR" -u "$app" 2>/dev/null || true
  done
  shopt -u nullglob
  if [ -d "build/DD/Build/Products/Debug/Scout for Safari.app" ]; then
    scripts/register-mac-extension.sh || true
  else
    echo "no dev build to re-register; run scripts/build-mac.sh so Safari uses it" >&2
  fi
}
trap restore_dev_build EXIT
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
