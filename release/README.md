# Releasing Scout

One command for every store Scout ships to:

```sh
./release.sh [ios|mac|chrome|firefox|all] [--beta] [--live]
```

- **Dry run by default.** It builds, archives and checks everything and uploads nothing. Add
  `--live` to publish.
- `ios` is iPhone and iPad, `mac` is the Mac app (both one App Store Connect record,
  `com.harrisonfischberg.Scoutai`). By default they go to App Review as version 1.0;
  `--beta` sends them to TestFlight with the next 0.N version instead.
- `chrome` uploads and publishes the Chrome Web Store package; `firefox` submits the listed
  Firefox add-on with its source code.
- `all` = ios, mac, chrome, firefox. There is no Android app (Firefox for Android installs the
  Firefox add-on), so `android` just says so.
- Apple targets run only on the Mac (Xcode). Chrome and Firefox run anywhere with Node 22.

Examples: `./release.sh all` (check everything), `./release.sh ios --beta --live` (TestFlight),
`./release.sh all --live` (submit everywhere).

## What's in `store/`

| Folder | Contents | Sent by the script? |
| --- | --- | --- |
| `store/apple/metadata/` | name, subtitle, description, keywords, promo text, URLs, categories (Productivity, Utilities), copyright, review contact and notes (fastlane `deliver` format) | yes |
| `store/apple/age_rating.json` | age rating answers: none/no everywhere, override to 18+ | yes |
| `store/apple/screenshots/ios/en-US/` | iPhone 6.9" (1320x2868), iPhone 6.3" (1206x2622), iPad 13" (2064x2752) | yes |
| `store/apple/screenshots/mac/en-US/` | Mac (2880x1800) | yes |
| `store/chrome/listing.md`, `store/chrome/screenshots/` | Chrome text, privacy answers, screenshots, promo tiles | no: the Chrome API takes only the package, paste once by hand |
| `store/firefox/amo-metadata.json` | Firefox summary, description, category, license, reviewer notes | yes |

The screenshots are rendered from `app-store/art-source/` in the project files. Check a new set
with `npm run check:screenshots` (it accepts both iPhone sizes).

For a version after 1.0, add `store/apple/metadata/en-US/release_notes.txt` and change
`app_version` in `fastlane/Fastfile`. Chrome and Firefox need a higher `version` in
`src/manifest.json` for every upload.

## Environment variables

Put these in `~/.zshrc` (or a password manager's shell plugin). Never in the repo: `.gitignore`
blocks `.env`, `*.p8` and keystores, but keep the files outside the repo anyway.

| Variable | Used by | What it is |
| --- | --- | --- |
| `ASC_KEY_ID` | ios, mac | App Store Connect API key ID |
| `ASC_ISSUER_ID` | ios, mac | Issuer ID shown above the keys list |
| `ASC_KEY_PATH` | ios, mac | Path to `AuthKey_XXXX.p8`, e.g. `~/.appstoreconnect/AuthKey_XXXX.p8` |
| `SCOUT_REVIEW_PHONE` | ios, mac `--live` | Your phone number for App Review (private, never shown on the App Store) |
| `SCOUT_REVIEW_TEST_KEY` | ios, mac `--live` | Anthropic test key with a low spending limit, put into the review notes; revoke after review |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | chrome `--live` | Google OAuth client and refresh token for the Chrome Web Store API |
| `CWS_EXTENSION_ID` | chrome `--live` | The item ID from the Chrome developer dashboard |
| `CWS_PUBLISHER_ID` | chrome `--live` | Your publisher ID (the current Chrome Web Store API needs it) |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | firefox `--live` | addons.mozilla.org API key and secret |

## One-time setup checklist

1. **Mac tools:** `brew install fastlane`. Xcode and Node 22 are already there.
2. **App Store Connect API key:** App Store Connect > Users and Access > Integrations > Team
   Keys > + (role App Manager or Admin). Download the `.p8` once, move it to
   `~/.appstoreconnect/`, and set the three `ASC_` variables.
3. **Chrome Web Store API:** follow https://github.com/fregante/chrome-webstore-upload-keys to
   make an OAuth client and refresh token; copy the extension ID and publisher ID from the
   developer dashboard.
4. **Firefox API key:** https://addons.mozilla.org/developers/addon/api/key/ gives the JWT
   issuer and secret.
5. Run `./release.sh all` (dry run) and fix anything it reports before the first `--live`.

## Steps that can't be automated

Apple and the browser stores keep these behind their own web pages. Each is done once (or when
the answer changes); the details and answers are in `docs/app-store-submission.md` and
`store/chrome/listing.md`.

- **Developer accounts and fees:** Apple Developer Program ($99 a year, already paid; the
  Organization conversion to Rare Creatures LLC waits on D-U-N-S), Chrome Web Store ($5 once),
  Firefox Add-ons (free).
- **First store listings:** the App Store Connect app record exists. The Chrome item has to be
  created by uploading the first zip by hand (that's where `CWS_EXTENSION_ID` comes from).
  Firefox's first listed upload can go through `release.sh` (the add-on ID never changes).
- **App Privacy answers** (App Store Connect > App Privacy): Other User Content and Browsing
  History, App Functionality, not linked, no tracking. They carry over between versions.
- **Privacy and data forms elsewhere:** the Chrome privacy practices tab, Firefox's privacy
  policy link, and screenshots on both browser stores.
- **Agreements and EU trader status:** accept the latest agreements in App Store Connect >
  Business and declare trader status (Digital Services Act) with the LLC's phone and email;
  Chrome's trader declaration is in its developer dashboard settings.
- **Price and availability** (free, all countries except China mainland), set once in App
  Store Connect.
- **Pressing Release** after Apple approves (the listing is set to manual release), and
  revoking the review test key.
