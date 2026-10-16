# Scout for Safari

Your AI Scout for the Safari Browser. A Safari Web Extension for macOS
and iOS, opened from the binoculars button in the toolbar (on iPhone and iPad,
from the page menu). It uses your own Anthropic or OpenAI API key, kept in your
Keychain. There is no Scout for Safari server.

- **Chat** about anything. When a question is about the page you are on,
  Scout for Safari uses the page; otherwise it answers like any chat window.
- **Summarize** a page, or ask across other open tabs.
- **Control Browser**: a supervised agent that acts on the page, and asks
  before anything sensitive.
- **Find coupons** on supported store carts.
- **Settings**: pick the model and effort level from dropdowns.

Each tab keeps its own conversation. Scout for Safari is off in Private Browsing.
Shortcut on Mac: Control-Shift-S opens and closes it.

## Build and test

| Check | Command |
| --- | --- |
| Unit tests | `npm test` |
| Types / lint | `npm run typecheck`, `npm run lint` |
| Extension bundle | `npm run build` |
| End-to-end (WebKit) | `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright npx playwright test` |
| Release bundle has no debug code | `npm run check:release` |
| Old name fully removed | `npm run check:rename` |
| Toolbar icons from `design/icons/` | `node scripts/render-toolbar-icons.mjs` |
| Mac app (signed, registered with Safari) | `scripts/build-mac.sh` |

Xcode project: `apple/SafariScout.xcodeproj` (schemes "Scout for Safari (macOS)",
"Scout for Safari (iOS)", `SafariScoutTests`, `SafariScoutUITests`). More detail
in `CLAUDE.md`, `prd.md`, and `docs/`.
