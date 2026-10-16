#!/usr/bin/env bash
# Makes Safari on this Mac see the latest Mac build of AssistAnt:
# unregisters iOS Simulator copies that share the bundle ID (they hide the Mac
# extension), registers the Mac app, and relaunches it.
set -euo pipefail
cd "$(dirname "$0")/.."
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
P="$PWD/build/DD/Build/Products"
for p in "$P/Debug-iphonesimulator/AssistAnt.app" "$P/Debug-iphonesimulator/AssistAntUITests-Runner.app" \
         "$P/Debug-iphonesimulator/AssistAnt Extension.appex" "$P/Debug/AssistAnt Extension.appex"; do
  [ -e "$p" ] && "$LSR" -u "$p" 2>/dev/null || true
done
touch build/.metadata_never_index
pkill -f 'Debug/AssistAnt.app/Contents/MacOS/AssistAnt' || true
sleep 1
"$LSR" -f -R "$P/Debug/AssistAnt.app"
open "$P/Debug/AssistAnt.app"
sleep 2
pluginkit -mAv -p com.apple.Safari.web-extension | grep AssistAnt | sed 's/^ *//'
