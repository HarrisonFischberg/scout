#!/usr/bin/env bash
# Builds the extension and the iOS app, then installs it on a connected
# iPhone or iPad (cable or same Wi-Fi). Does not launch the app: Safari picks
# up the new extension on its own.
# Signing: Xcode automatic signing with the team in the project
# (scripts/set-ios-signing.rb); -allowProvisioningUpdates lets Xcode fetch
# or renew the development profile.
# Device: SCOUT_IOS_DEVICE (UDID or name), else the first paired physical
# iOS device, preferring one already connected.
# Needs to run outside the sandbox (devicectl, provisioning, Keychain).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run --silent build
DEVICE="${SCOUT_IOS_DEVICE:-}"
if [ -z "$DEVICE" ]; then
  json="$(mktemp)"
  xcrun devicectl list devices --json-output "$json" >/dev/null
  DEVICE="$(node -e '
    const out = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const ds = out.result.devices.filter(d =>
      d.hardwareProperties?.reality === "physical" &&
      d.hardwareProperties?.platform === "iOS" &&
      d.connectionProperties?.pairingState === "paired");
    const d = ds.find(x => x.connectionProperties.tunnelState === "connected") ?? ds[0];
    if (d) console.log(d.hardwareProperties.udid);
  ' "$json")"
  rm -f "$json"
fi
if [ -z "$DEVICE" ]; then
  echo "No paired iPhone or iPad found. Connect it, unlock it, and try again." >&2
  exit 1
fi
echo "device: $DEVICE"
xcodebuild -project apple/SafariScout.xcodeproj -scheme "Safari Scout (iOS)" \
  -destination "id=$DEVICE" -derivedDataPath build/DD -allowProvisioningUpdates build 2>&1 \
  | grep -E ' error:|BUILD'
APP="build/DD/Build/Products/Debug-iphoneos/Safari Scout.app"
scripts/check-extension-bundle.sh "$APP/PlugIns/Safari Scout Extension.appex"
xcrun devicectl device install app --device "$DEVICE" "$APP" 2>&1 | grep -E 'App installed|bundleID|rror'
echo "Installed. Open Safari to use the new version."
