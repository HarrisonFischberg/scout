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
| `tabs.Tab.incognito` | 14 | 15 | marks a private tab, whose chats are deleted when it closes (since 2026-10-17; before that the panel was off there) | no |
| `extension.inIncognitoContext` | 18 | 18 | second Private Browsing signal (Part 1); the page button no longer checks it | no |
| `tabs.onActivated`, `tabs.onRemoved`, `runtime.onStartup` | 14 | 15 | per-tab panel state (Part 1) | no |
| `runtime.getPlatformInfo` | 14 | 15 | "mac" hides Button on webpages and its setting (since 2026-10-17) | no |
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

## Button on webpages (T032, 2026-10-16)

iOS Safari has no extension API to place a button beside the address bar
(Apple's iPhone User Guide, iOS 27: extensions are reached from the page
menu; tab bar layouts are Compact, Bottom, Top only). T032 draws its own tab on
the page instead. APIs it relies on (MDN browser-compat-data, read from GitHub
2026-10-16; none runtime-verified):

| API | macOS Safari | iOS Safari | Use | Runtime-verified |
| --- | --- | --- | --- | --- |
| `scripting.registerContentScripts` / `unregisterContentScripts` / `getRegisteredContentScripts` | 16.4 | 16.4 (mirror) | edge script only on granted origins | iOS Simulator 2026-10-16: tab appeared on the granted site |
| `action.openPopup` from the worker, after a tap in a content script | 16 | 16 | the tab opens the toolbar panel | iOS Simulator 2026-10-16: Safari opened the panel sheet (log: `action.openPopup()` called, no errors) |
| `permissions.onAdded` / `onRemoved` | not checked | not checked | re-register when grants change (optional; also re-checked at startup) | no |
| HTML `popover` | web platform | web platform | tab in the top layer | iOS Simulator: tab drawn over the page |

Do not frame extension pages in websites (`web_accessible_resources` with a
page). Owner bug report 2026-10-16: on iOS Safari 27.0.1 such a frame runs in
the page's own web process; when it called `tabs.query()` WebKit logged
"Received an invalid message WebExtensionContext_TabsQuery from WebContent
process" and terminated the process, so the page showed "This webpage was
reloaded because a problem occurred". The manifest entry also made Safari ask
for site access ("Permission Required") before the panel would open.

## Part 2: conversation, context and tools (2026-10-16)

Answers now run in the background worker (the Scout server), so the worker
calls the provider, reads pages, and runs tools. Sources: MDN
browser-compat-data as read for T002 and T032 (rows above) where noted; the
rows marked "recalled" could not be re-checked this session because the
request to fetch MDN data was denied (`docs/launch-blockers.md`, blocker 25).
The code checks every optional API at runtime before using it.

| API | macOS Safari | iOS Safari | Part 2 use | Runtime-verified |
| --- | --- | --- | --- | --- |
| `scripting.executeScript({ func })` from the worker | 15.4 | 15.4 | chat page context (`src/context/extract.ts`) | iOS Simulator 2026-10-16: current tab yes; a background tab no (known iOS limit) |
| `tabs.captureVisibleTab` from the worker | 14 | 15 | `screenshot_visible` (JPEG, scaled to 1568 px) | iOS Simulator 2026-10-16: yes (721 × 1568 JPEG) |
| `tabs.get`, `tabs.create`, `tabs.remove` | 14 | 15 (recalled) | tool host: tab info before reading, `open_tab`, `close_tabs` | iOS Simulator 2026-10-16: yes |
| `tabs.query({})` (all windows) | 14 | 15 | `search_tabs` (only when turned on) | iOS Simulator 2026-10-16: yes |
| `history.search` | not supported (recalled) | not supported (recalled) | `search_tabs` would include history; absent, so open tabs only | iOS Simulator 2026-10-16: absent, as expected |
| `sessions.getRecentlyClosed` | not supported (recalled) | not supported (recalled) | `search_tabs` would include recently closed tabs; absent | iOS Simulator 2026-10-16: absent, as expected |
| `tabs.group` / `tabs.ungroup` / `tabGroups` | not supported (recalled) | not supported (recalled) | `group_tabs` / `ungroup_tabs` answer `unsupported` and are not offered to the model | iOS Simulator 2026-10-16: absent, as expected |
| `runtime.connect` port from popup to worker, kept open while streaming | 14 | 15 | answer events with sequence numbers; resubscribe after a reconnect | iOS Simulator 2026-10-16: yes, including resume after reopening the sheet |
| Non-persistent background page lifetime during a provider stream with no open port | Safari decides | Safari decides | answers continue after the popover closes, if Safari keeps the worker | iOS Simulator 2026-10-16: kept for a 24 s answer with the sheet closed; real iPhone and Mac not checked (blocker 24) |
| MathML Core rendering in the popup | 16 | 16 (recalled) | math in answers (`src/chat/math.ts`) | iOS Simulator 2026-10-16: yes |
| `UserDefaults.objectIsForced(forKey:)` in the extension (Swift) | macOS 10.10+ (recalled) | iOS (recalled) | organization blocklist (`ManagedPolicy.swift`) | XCTest only; no real profile (blocker 26) |

## Part 3: Scout mode and overlay (2026-10-17)

Spec 11 platform note, applied to Safari: both preferred options are absent,
so both fallbacks are built. Not runtime-verified in Safari yet (launch blocker
30); the e2e suite ran on Chromium in the build session because WebKit could
not be installed there.

| Capability | Preferred (spec) | Safari | Built | Runtime-verified |
| --- | --- | --- | --- | --- |
| Actions | browser-level input automation (`debugger` / CDP-style input) | no extension API for synthesized input in Safari (not in MDN BCD for `safari`) | DOM events from a content script (`src/actions/task-dom.ts`): pointer, mouse, keyboard, drag events plus `HTMLElement.click()` for activation behavior; values set through the prototype setter with `input` / `change` events | no |
| Overlay | browser-level overlay view | none for extensions | page-layer overlay from a content script (`src/overlay.ts`): fixed host in the top layer (`popover`), open shadow root, `pointer-events: none` except the pill | no |
| `scripting.executeScript` from the worker with `files` and `func` (inject `content.js` / `overlay.js` on demand, call their handlers) | — | 15.4 | the worker reaches the tab this way (as the Part 2 context read does) | Part 2 context read: iOS Simulator 2026-10-16; task calls: no |
| `tabs.captureVisibleTab` from the worker, per batch | — | 14 / 15 | screenshot per batch where allowed for the site | Part 2 screenshot tool: iOS Simulator 2026-10-16; per batch: no |
| `action.setIcon` with `tabId` | — | 15.4 | filled-lens icon on the task's tab | no (tab-scoped icon not checked; the Part 1 global swap works) |
| CSS `@property` / `CSS.registerProperty` | — | 16.4 | the conic-gradient sweep angle; registered on the document because @property rules are ignored inside shadow trees | no. Safari 16.0–16.3: static border (allowed by spec 9) |
| `mask-composite` / `-webkit-mask-composite` for the border ring | — | 15.4 (`-webkit-` form) | both forms set | no |
| `prefers-reduced-motion`, `visibilitychange` | — | yes | static border; sweep paused while hidden | no |
| `HTMLFormElement.requestSubmit` | — | 16 | Enter in a form field submits it (after confirmation) | no |

Known limits of the fallback column: DOM events cannot type into
cross-origin iframes or into native controls that only react to trusted
events (file pickers, some date pickers); a page's `isTrusted` checks can
ignore synthetic clicks; coordinate clicks go through `elementFromPoint`, so an
element covered by another is not reachable. The spec asks for the fallback on
Safari, and these limits are reported to the model as failed actions.

## Still to verify (T002 acceptance, runtime part)

1. Extension loads in Safari on macOS (enable under Safari Settings >
   Extensions) with the `background.scripts` + `persistent: false` manifest.
2. Extension loads on the iOS Simulator (Safari extension enabled in
   Settings).
3. Popup `ping` round-trip reaches the background script.
4. Native messaging ping reaches `SafariWebExtensionHandler` and returns `ok`.
