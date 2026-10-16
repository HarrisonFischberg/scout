#!/usr/bin/env bash
# Makes Safari on this Mac see the latest Mac build of Safari Scout:
# unregisters iOS Simulator copies that share the bundle ID (they hide the Mac
# extension) and registers the Mac app and its extension. It does not launch
# the app: the extension runs inside Safari, so the app stays out of the Dock
# and Command-Tab. Pass --open to also show the setup window.
set -euo pipefail
cd "$(dirname "$0")/.."
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
P="$PWD/build/DD/Build/Products"
for p in "$P/Debug-iphonesimulator/Safari Scout.app" "$P/Debug-iphonesimulator/SafariScoutUITests-Runner.app" \
         "$P/Debug-iphonesimulator/Safari Scout Extension.appex" "$P/Debug/Safari Scout Extension.appex"; do
  [ -e "$p" ] && "$LSR" -u "$p" 2>/dev/null || true
done
touch build/.metadata_never_index
pkill -f 'Debug/Safari Scout.app/Contents/MacOS/Safari Scout' || true
sleep 1
"$LSR" -f -R "$P/Debug/Safari Scout.app"
pluginkit -a "$P/Debug/Safari Scout.app/Contents/PlugIns/Safari Scout Extension.appex"
[ "${1:-}" = "--open" ] && open "$P/Debug/Safari Scout.app"
sleep 1
pluginkit -mAv -p com.apple.Safari.web-extension | grep "Safari Scout" | sed 's/^ *//'
