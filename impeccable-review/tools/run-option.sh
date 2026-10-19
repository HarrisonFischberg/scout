#!/usr/bin/env bash
# Captures the 4 key panel screens for one prototype option (light, dark, Mac, iPhone).
set -e
n=$1
cd "$(dirname "$0")/../.."
OUT=impeccable-review/option-$n THEME=impeccable-review/option-$n/prototype/theme.css \
THEME_JS=impeccable-review/option-$n/prototype/theme.js SHOTS=02-new-chat,04-answer,08-coupons,12-settings \
npx playwright test -c impeccable-review/tools/pw.config.ts panel.capture 2>&1 | grep -E "✘|passed|failed|Error" || true
