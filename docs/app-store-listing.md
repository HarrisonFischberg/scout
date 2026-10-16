# App Store listing

Names and short copy decided by the owner on 2026-10-16. Other listing
fields (description, keywords, screenshots, support and privacy URLs) are not
written yet; they wait on launch-blockers 1 and 8.

| Field | Text | Length / limit | Where it is set |
| --- | --- | --- | --- |
| App name | Scout for Safari | 16 / 30 | App Store Connect (not in this repo) |
| Subtitle | AI Scout for Safari Browser | 27 / 30 | App Store Connect (not in this repo) |
| iOS home-screen name | Scout | 5 | `APP_DISPLAY_NAME` in the iOS app target, read by `apple/App/Info.plist` |
| Mac app name | Scout for Safari | — | `APP_DISPLAY_NAME` and `PRODUCT_NAME` in the macOS app target |
| Extension name (Safari settings, toolbar) | Scout for Safari | — | `src/manifest.json` `name`, `apple/Extension/Info.plist` |
| Tagline in the extension and app | Your AI Scout for the Safari Browser | 36 | `src/manifest.json` `description`, onboarding screen, README |

The name "Scout for Safari" is approved per the owner (2026-10-16);
see launch-blocker 21.
