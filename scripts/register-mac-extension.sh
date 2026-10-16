#!/usr/bin/env bash
# Makes Safari on this Mac see the latest Mac build of Scout for Safari:
# unregisters iOS Simulator copies that share the bundle ID (they hide the Mac
# extension) and registers the Mac app and its extension. It does not launch
# the app: the extension runs inside Safari, so the app stays out of the Dock
# and Command-Tab. Pass --open to also show the setup window.
set -euo pipefail
cd "$(dirname "$0")/.."
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
P="$PWD/build/DD/Build/Products"
for p in "$P/Debug-iphonesimulator/Scout for Safari.app" "$P/Debug-iphonesimulator/SafariScoutUITests-Runner.app" \
         "$P/Debug-iphonesimulator/Scout for Safari Extension.appex" "$P/Debug/Scout for Safari Extension.appex"; do
  [ -e "$p" ] && "$LSR" -u "$p" 2>/dev/null || true
done
touch build/.metadata_never_index
pkill -f 'Debug/Scout for Safari.app/Contents/MacOS/Scout for Safari' || true
sleep 1
"$LSR" -f -R "$P/Debug/Scout for Safari.app"
pluginkit -a "$P/Debug/Scout for Safari.app/Contents/PlugIns/Scout for Safari Extension.appex"
[ "${1:-}" = "--open" ] && open "$P/Debug/Scout for Safari.app"
sleep 1
pluginkit -mAv -p com.apple.Safari.web-extension | grep "Scout for Safari" | sed 's/^ *//'
