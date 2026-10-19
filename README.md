# Scout AI Assistant

Your AI assistant for Safari, Chrome and Firefox (formerly Scout for Safari).
A Web Extension for Safari on macOS and iOS, Chrome and Firefox, opened from the
Scout truck button in the toolbar (on iPhone and iPad, from the page menu). It
uses your own Anthropic or OpenAI API key, kept in your Keychain on Safari and in
the browser's local extension storage on Chrome and Firefox. There is no Scout
server.

- **Chat** about anything. When a question is about the page you are on,
  Scout uses the page; otherwise it answers like any chat window.
- **Summarize** a page, or ask across other open tabs.
- **Scout mode**: a supervised agent that carries out a task on the page for
  you, step by step, under a glowing page with Take control and Stop. Sending
  a task starts it at once; before anything sensitive (buying, sending, signing in,
  deleting, submitting, downloading) it asks, every time.
- **Find coupons** on a cart or checkout page: searches the live web for codes
  posted for that store (coupon sites, creators, the store's own pages), keeps
  each code's page as evidence, tests every code in your cart one at a time,
  and leaves the best verified discount applied. It never guesses codes and
  never checks out.
- **Settings**: pick the model and effort level from dropdowns.

Each tab keeps its own conversation. Scout works in Private Browsing; chats in a private tab are deleted when the tab closes.
Settings > Permissions lists every permission with its default; all of them are
enforced on the device.
Shortcut on Mac: Control-Shift-S opens and closes it.

## Build and test

| Check | Command |
| --- | --- |
| Unit tests | `npm test` |
| Types / lint | `npm run typecheck`, `npm run lint` |
| Extension bundle | `npm run build` |
| Chrome / Firefox store packages | `npm run build:chrome`, `npm run build:firefox` (release; `dist/<browser>/` and `dist/scout-<browser>-<version>.zip`) |
| End-to-end (WebKit) | `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright npx playwright test` |
| Release bundle has no debug code | `npm run check:release` |
| Old name fully removed | `npm run check:rename` |
| Toolbar icons from `design/icons/` | `node scripts/render-toolbar-icons.mjs` |
| Mac app (signed, registered with Safari) | `scripts/build-mac.sh` |

Xcode project: `apple/SafariScout.xcodeproj` (schemes "Scout for Safari (macOS)",
"Scout for Safari (iOS)", `SafariScoutTests`, `SafariScoutUITests`). More detail
in `CLAUDE.md`, `prd.md`, and `docs/`.
