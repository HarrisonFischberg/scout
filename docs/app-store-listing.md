# App Store listing

Names and short copy decided by the owner on 2026-10-16; renamed to Scout AI
Assistant on 2026-10-19 (owner, so the same name works on Chrome and Firefox;
their listings are in `docs/store-listings.md`). The full App Store
listing (description, keywords, URLs, privacy label, age rating, review notes,
screenshots) is in `docs/app-store-submission.md` (2026-10-20).

| Field | Text | Length / limit | Where it is set |
| --- | --- | --- | --- |
| App name | Scout AI Assistant | 18 / 30 | App Store Connect (not in this repo) |
| Subtitle | AI assistant for Safari | 23 / 30 | App Store Connect (not in this repo) |
| iOS home-screen name | Scout | 5 | `APP_DISPLAY_NAME` in the iOS app target, read by `apple/App/Info.plist` |
| Mac app name (Dock, menu bar) | Scout AI Assistant | — | `APP_DISPLAY_NAME` in the macOS app target (`PRODUCT_NAME`, the built file name, is still "Scout for Safari") |
| Extension name (Safari settings, toolbar) | Scout AI Assistant | — | `src/manifest.json` `name`, `apple/Extension/Info.plist` |
| Extension description | Your AI assistant in the browser: summarize pages, ask questions, compare tabs, fill forms and find coupons with your own AI key. | 129 / 132 | `src/manifest.json` `description` |

The name "Scout AI Assistant" is the owner's choice (2026-10-19; earlier "Scout for Safari", 2026-10-16);
see launch-blocker 21.
