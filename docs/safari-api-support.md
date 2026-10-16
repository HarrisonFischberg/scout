# Safari API support (T002)

Status: DOCUMENTED, NOT RUNTIME-VERIFIED. Nothing here has been loaded in
Safari 27. The runtime check needs Safari on macOS and an iOS Simulator, which
this session cannot start (see `docs/launch-blockers.md` #9 and #10).

Source: MDN browser-compat-data 8.1.6 (`@mdn/browser-compat-data` on npm,
read locally 2026-10-15). Values are MDN's `safari` (macOS) and `safari_ios`
`version_added` records. No `partial_implementation` or `flags` markers were
present on these rows. Apple's Safari web extensions page returned only its
title to the fetch tool, so Apple is not a source here.

| API | macOS Safari | iOS Safari | Scout for Safari use (PRD) | Runtime-verified |
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
| `commands` / `_execute_action` (MV3) | 15.4 | 15.4 | "Toggle Scout for Safari" shortcut (Part 1) | no. MDN: changing a command's shortcut is not supported, so it is not user-configurable |
| `action.openPopup` | 16 | 16 | reopen the panel when switching back to a tab where it was open (Part 1) | no |
| `action.setTitle` | 15.4 | 15.4, partial | "Open / Close Scout for Safari" (Part 1) | no. MDN: on iOS the title is not shown |
| `action.setIcon` | 15.4 | 15.4 | light/dark toolbar icon swap (Part 1) | no |
| `action` `theme_icons` | not supported | not supported | not used; the worker swaps icons on `prefers-color-scheme` | n/a |
| `runtime.connect` / `Port` | 14 | 15 | `scout-panel` port (Part 1) | no |
| `tabs.Tab.incognito` | 14 | 15 | panel off in Private Browsing (Part 1) | no |
| `extension.inIncognitoContext` | 18 | 18 | second Private Browsing signal (Part 1) | no |
| `tabs.onActivated`, `tabs.onRemoved`, `runtime.onStartup` | 14 | 15 | per-tab panel state (Part 1) | no |
| `manifest.incognito` | 17, partial | 17, partial | not set: Safari controls it with a user setting | n/a |

## What this changes

- `sidePanel` is unsupported in Safari per MDN. The PRD's toolbar popup
  design stands. `docs/rea-findings.md` finding 3 moves from "inferred" to
  "documented, unverified."
- `tabs.captureVisibleTab` is listed from Safari 14 on macOS and 15 on iOS.
  Treat the iOS result as unconfirmed until a run shows it working.
- `contextMenus` and `activeTab` are missing from MDN BCD. They stay in the
  manifest because the PRD asks for them. Confirm at runtime.

## Part 1 platform note (2026-10-16)

Safari has no native side panel or sidebar (`sidePanel`, `sidebarAction`
unsupported), so the Scout panel is the toolbar popover. Consequences:

- Safari closes the popover when the user clicks the page or switches tabs.
  The worker treats a close followed within 400 ms by a tab switch as "left
  open" and calls `action.openPopup` when the user returns to that tab.
- No extension API hides the toolbar button. Users remove it with View >
  Customize Toolbar (Mac); on iPhone and iPad it sits in the page menu.
- The toggle shortcut cannot be remapped by the user in Safari.

## Still to verify (T002 acceptance, runtime part)

1. Extension loads in Safari on macOS (enable under Safari Settings >
   Extensions) with the `background.scripts` + `persistent: false` manifest.
2. Extension loads on the iOS Simulator (Safari extension enabled in
   Settings).
3. Popup `ping` round-trip reaches the background script.
4. Native messaging ping reaches `SafariWebExtensionHandler` and returns `ok`.
