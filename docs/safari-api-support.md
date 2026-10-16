# Safari API support (T002)

Status: DOCUMENTED, NOT RUNTIME-VERIFIED. Nothing here has been loaded in
Safari 27. The runtime check needs Safari on macOS and an iOS Simulator, which
this session cannot start (see `docs/launch-blockers.md` #9 and #10).

Source: MDN browser-compat-data 8.1.6 (`@mdn/browser-compat-data` on npm,
read locally 2026-10-15). Values are MDN's `safari` (macOS) and `safari_ios`
`version_added` records. No `partial_implementation` or `flags` markers were
present on these rows. Apple's Safari web extensions page returned only its
title to the fetch tool, so Apple is not a source here.

| API | macOS Safari | iOS Safari | Safari Scout use (PRD) | Runtime-verified |
| --- | --- | --- | --- | --- |
| `sidePanel` | not supported | not supported | not used; toolbar popup instead | n/a |
| `sidebarAction` | not supported | not supported | not used | n/a |
| `tabs.query` | 14 | 15 | `@tab` multi-tab context (T012) | no |
| `tabs.captureVisibleTab` | 14 | 15 | screenshots for agent grounding, if used (T008/T010) | no |
| `scripting.executeScript` | 15.4 | 15.4 | page snapshot and actions (T008/T009) | no |
| `runtime.sendNativeMessage` | 14 | 15 | Keychain bridge to `SafariWebExtensionHandler` (T004) | no |
| `storage` | 14 | 15 | settings, history (T015) | no |
| `contextMenus` | not in BCD | not in BCD | PRD permission; no feature yet | no. Remove from manifest if Safari rejects it |
| `activeTab` | not in BCD (permission) | not in BCD | manifest permission | no |

## What this changes

- `sidePanel` is unsupported in Safari per MDN. The PRD's toolbar popup
  design stands. `docs/rea-findings.md` finding 3 moves from "inferred" to
  "documented, unverified."
- `tabs.captureVisibleTab` is listed from Safari 14 on macOS and 15 on iOS.
  Treat the iOS result as unconfirmed until a run shows it working.
- `contextMenus` and `activeTab` are missing from MDN BCD. They stay in the
  manifest because the PRD asks for them. Confirm at runtime.

## Still to verify (T002 acceptance, runtime part)

1. Extension loads in Safari on macOS (enable under Safari Settings >
   Extensions) with the `background.scripts` + `persistent: false` manifest.
2. Extension loads on the iOS Simulator (Safari extension enabled in
   Settings).
3. Popup `ping` round-trip reaches the background script.
4. Native messaging ping reaches `SafariWebExtensionHandler` and returns `ok`.
