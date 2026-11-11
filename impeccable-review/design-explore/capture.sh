#!/usr/bin/env bash
# Design exploration previews: ./capture.sh [baseline|A|B|C ...] -> build/dx/<id>/mac-{1-summary,3-scout-mode}.png
# Real panel (apple/Extension/Resources, run `npm run build` first) in Chromium at the Mac popover size, 400x600 @3x.
set -e
cd "$(dirname "$0")/../.."
[ $# -eq 0 ] && set -- baseline A B C
for id in "$@"; do
  [ "$id" = baseline ] && theme= || theme=impeccable-review/design-explore/$id.css
  OUT=build/dx/$id DEV=mac VH=600 SYSFONT=1 THEME=$theme DESIGN=$id npx playwright test -c impeccable-review/tools/appstore.config.ts -g "summary|scout mode" 2>&1 | grep -E "✘|passed|failed|Error" || true
done
