# Beta testers via TestFlight: Scout for Safari (and NightCast)

> 2026-10-20: the owner decided to skip TestFlight and submit straight to the
> App Store. The signing and upload steps here still apply (App Store Connect
> takes the same upload); the submission itself is in
> `docs/app-store-submission.md`.

Written 2026-10-17 against `main` (1d51dd3) plus the TestFlight prep branch.

## Short answer

Yes. TestFlight's **public link** is built for this. You turn it on in App Store
Connect, get a URL like `https://testflight.apple.com/join/AbCd1234`, and put it
behind a "Join the beta" button on your website. Anyone who taps it installs
Apple's free TestFlight app and then Scout, on iPhone, iPad, or Mac (macOS 12+).
The Safari extension ships inside the app, so it comes along automatically.

- Up to 10,000 external testers per app; you can cap the link lower.
- The first build of each version goes through **Beta App Review** (usually about
  a day). Later builds of the same version usually go straight out.
- Each build expires after 90 days, so testers need a fresh build at least that often.
- Testers send feedback and screenshots from inside TestFlight; you read it in
  App Store Connect.

## What you already have

- Paid Apple Developer Program, Individual team `KTV2G3Z883` (launch blocker 2).
- iOS targets already use `com.harrisonfischberg.Scoutai` and
  `com.harrisonfischberg.Scoutai.Extension`, signed by that team.
- Archives use the Release configuration, which contains no debug-only code
  (`npm run check:release`). It does include the on-device debug log
  (+ → Copy debug log), so TestFlight builds can report bugs.

## Repo side (done in `scripts/prepare-testflight.rb`, 2026-10-17)

1. Mac app and extension use `com.harrisonfischberg.Scoutai` (+ `.Extension`) and
   team `KTV2G3Z883`, like iOS, so one App Store Connect record covers iPhone and Mac.
   `apple/App/OnboardingView.swift` names the new extension ID. Side effect: the
   installed Mac build forgets its saved API key once, and Safari re-registers the
   extension (turn it on again in Safari Settings > Extensions).
2. `PrivacyInfo.xcprivacy` in the app and the extension on both platforms: no tracking,
   no collected data, `UserDefaults` for the app's own settings (reason `CA92.1`).
   Without it, uploads get ITMS-91053.
3. `apple/App/Info.plist`: `ITSAppUsesNonExemptEncryption = NO` (HTTPS only) and
   `LSApplicationCategoryType = public.app-category.productivity` (Mac uploads need it).
4. `scripts/archive-testflight.sh`: runs `npm run check:release`, builds the release
   extension bundle, archives the Release build for each platform, and uploads with
   `scripts/ExportOptions-testflight.plist`. Each upload gets the next short version on
   both platforms (0.2, 0.3, ...; TestFlight shows "Version 0.N"). The last uploaded N
   is kept in `~/.scout-testflight-number` on the Mac and moves on only after every
   platform uploaded; `SCOUT_VERSION_NUMBER=N` sets it by hand. The build number stays
   a timestamp (`20261017.2100`): Apple requires each Mac build number to be higher
   than every earlier Mac upload, and the first uploads already used timestamps.
   `--no-upload` stops after the archive; `SCOUT_PLATFORMS=iOS` does one platform.
   On exit it unregisters the Release copies the archive leaves (DerivedData
   ArchiveIntermediates, the `.xcarchive`, the export folder) and re-registers the dev
   build, so Safari keeps using the working build instead of a blank-icon Release copy.
5. Still to check on the Mac after the first team-signed Release build: the extension
   reads the key the app saved (launch blocker 14, Mac half). If it doesn't, the Mac
   targets need the shared Keychain access group iOS already has.

## What only you can do (Apple account and Mac)

1. **developer.apple.com → Identifiers:** confirm `com.harrisonfischberg.Scoutai`
   and `.Extension` exist as explicit App IDs (Xcode may have made them already for
   your iPhone builds).
2. **App Store Connect → Apps → +:** New App, platforms iOS and macOS, bundle ID
   `com.harrisonfischberg.Scoutai`, name "Scout for Safari" (the name must be
   unused on the App Store).
3. **TestFlight → Test Information:** beta description, feedback email, and a
   privacy policy URL. Your website can host `docs/legal/privacy-policy.md`.
4. **Review notes:** say testers bring their own Anthropic or OpenAI key. Beta App
   Review may need a working key to try the app; a capped test key with a low
   spending limit is the usual answer.
5. **Upload:** `scripts/archive-testflight.sh` on the Mac, or in Xcode Product → Archive
   (once per platform), then Distribute App → TestFlight & App Store. Xcode must be
   signed in to your Apple ID (Xcode → Settings → Accounts).
6. **External Testing → new group → add the build → Enable Public Link.** Copy the
   link onto your website.

## How the website link works

One button, one link. On an iPhone or Mac without TestFlight, the page tells them
to install TestFlight first, then opens Scout's beta. Someone on both devices opens
the same link on each. You can set link criteria (device type, OS version) and a
tester cap, and turn the link off any time.

## Alternative for Mac only

You could also offer a direct Mac download (Developer ID signed and notarized .app)
from your site with no Beta App Review. iPhone has no equivalent: outside TestFlight,
iOS installs need each tester's device registered (100 max). TestFlight is the
simpler single path for both.

## NightCast

Same steps per app: its own bundle ID, App Store Connect record, privacy manifest,
upload, and its own public link (you'd have two "Join the beta" buttons, or one page
with both). I haven't seen NightCast's code; with its repo connected to this project
I can check its bundle IDs, signing, and privacy manifest the same way.

## Things that may come up in Beta App Review

- Scout applies coupon codes on store sites; merchant-terms legal review (launch
  blocker 4) is still open. Beta review is lighter than App Store review, but
  mention coupons plainly in the beta description.
- The legal drafts are not bundled into the app yet (launch blocker 19).
