# App Store submission kit: Scout AI Browser Assistant (iPhone, iPad, Mac)

Prepared 2026-10-20 so the public App Store submission is ready the day the
D-U-N-S letter arrives and the Apple developer account is converted to an
Organization (Rare Creatures LLC). Nothing here has been submitted. Claude
never signs in to App Store Connect and never handles the owner's Apple
credentials; every App Store Connect step is the owner's.

Owner decisions this kit follows:

- Skip TestFlight and go straight to App Store review (2026-10-20).
- The public listing shows the LLC, never the owner's personal name or address
  (2026-10-20). So nothing is submitted before the Organization conversion.
- Free app, no in-app purchases; users bring their own AI key.

Apple's rules below were read on 2026-10-20 from Apple's own pages
(App Review Guidelines "Last Updated: October 16, 2026", App Store Connect
Help, Apple Developer News). Sources are at the end. Re-read the guidelines
the week of submission if more than a month has passed.

## 1. What gets submitted

One App Store Connect app record with two platforms, iOS (iPhone and iPad)
and macOS, under bundle ID `com.harrisonfischberg.Scoutai`. The Safari
extension (`com.harrisonfischberg.Scoutai.Extension`) ships inside each
app; it is not listed separately.

| | iOS / iPadOS | macOS |
| --- | --- | --- |
| Minimum OS | iOS 17.0 | macOS 14.0 |
| Devices | iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`) | Mac |
| Home screen / Dock name | Scout | Scout AI Assistant |
| Sandbox | (iOS default) | App Sandbox on app and extension, network client on the app |
| Privacy manifest | `apple/App/PrivacyInfo.xcprivacy`, `apple/Extension/PrivacyInfo.xcprivacy` | same files |
| Encryption | `ITSAppUsesNonExemptEncryption = NO` (HTTPS through the system only) | same |
| Version | 0.1.0 (same as the Chrome and Firefox packages) | 0.1.0 |

Upload with `scripts/archive-testflight.sh` on the Mac (despite its name it
uploads to App Store Connect, which serves both TestFlight and App Store
review; nothing goes to testers unless a TestFlight group is created). Apple
currently requires uploads built with the iOS 26 SDK or later (since
2026-04-28) and will require the iOS 27 SDK from April 2027.

## 2. Listing text (App Store Connect > the app > the version page)

Paste these as they are. The App Store copy must not name Chrome, Firefox or
any other platform (guideline 2.3.10), and must not promise that coupons work
on every store (launch blocker 29).

The listing name is **Scout AI Browser Assistant** (owner, App Store Connect record
created 2026-10-22). The extension and Mac app still call themselves "Scout AI Assistant";
the iPhone home screen says "Scout". Paste-ready copies of this text and the screenshots are
in the project files at `app-store/listing-text.md`.

- **Name** (30 max): `Scout AI Browser Assistant` (26)
- **Subtitle** (30 max): `Summaries, answers, coupons` (27). The old subtitle,
  "AI assistant for Safari", repeats words now in the name.
- **Promotional text** (170 max, can change without a new review):
  `Ask about any page, get the short version, let Scout fill out forms, and find coupon codes at checkout. Free, with your own Anthropic or OpenAI key.` (148)
- **Keywords** (100 max, no repeats of name or subtitle words):
  `summarize,extension,chat,agent,promo code,questions,forms,reader,shopping,tabs,deals,discount,helper` (100).
  No competitor or AI brand names (2.3.7).
- **Description** (4000 max, 1,807 used):

> Scout AI Browser Assistant puts a friendly AI helper in Safari. Open Scout from the Safari toolbar on any page and:
>
> • Get the short version of a long article, recipe or report
> • Ask questions about what you're reading
> • Compare information across your open tabs (Mac)
> • Let Scout mode click, type and fill out forms for you, with a Stop button always on screen and a check with you before anything like buying, signing in or sending
> • Find coupon codes at checkout: Scout looks for codes posted online, adds a few common codes marked as guesses, tries them in the store's own coupon box, and keeps the one that saves the most
> • Talk instead of type with the microphone button (Mac)
>
> BRING YOUR OWN KEY
> Scout works with your own Anthropic or OpenAI API key, and you pay your provider directly for what you use. Scout shows an estimated cost after each answer. Scout itself is free, with no subscription and no in-app purchases.
>
> PRIVATE BY DESIGN
> There is no Scout account and no Scout server. Scout asks before it sends anything to an AI provider, and then your question and the page you ask about go straight from your device to the provider you picked. Your key stays in your Keychain. No analytics, no ads, no tracking.
>
> HOW IT WORKS
> Scout is a Safari extension. After installing, open the Scout app once and follow the steps to turn Scout on in Safari. On iPhone and iPad that's Settings > Apps > Safari > Extensions; on Mac, Safari > Settings > Extensions. Then tap Scout in Safari's toolbar and add your key in Scout's Settings.
>
> Coupons depend on each store: some stores don't have a coupon box Scout can reach, and some block automated entry, so not every checkout will find a saving.
>
> Scout AI Browser Assistant is made by Rare Creatures LLC. It is not made by or connected to Anthropic or OpenAI.

- **Support URL:** https://rarecreatures.app/support/
- **Marketing URL:** https://rarecreatures.app/apps/scout/
- **Privacy Policy URL:** https://rarecreatures.app/apps/scout/privacy/
  (published, names Rare Creatures LLC, no personal name or address; checked
  2026-10-20). The app and the extension's Settings link to the same page
  (guideline 5.1.1(i)).
- **Copyright:** `2026 Rare Creatures LLC`
- **Primary category:** Productivity. **Secondary:** Utilities.
- **License agreement:** Apple's standard EULA (Scout has no published terms
  of its own yet; `docs/legal/terms.md` is still a draft).
- **What's New:** not shown for the first version.

The 4.4 rule ("clearly and accurately disclose what extensions are made
available in the app's marketing text") is covered by the "How it works"
paragraph.

## 3. App Privacy (App Store Connect > App Privacy)

Apple counts data as "collected" when it leaves the device and you or a
partner keep it longer than needed to answer the request. Scout keeps nothing,
but questions, page text and page addresses go to the user's AI provider,
which keeps them under the user's own account. Declaring them is the honest
answer and gives App Review no reason to question the label (since November
2025, 5.1.2(i) says sharing with third-party AI must be disclosed, and App
Review has been rejecting AI apps over it). The extension's
`PrivacyInfo.xcprivacy` declares the same two types.

**Do you or your third-party partners collect data from this app?** Yes.

| Data type (Apple's category) | What Scout sends | Purpose | Linked to the user? | Used for tracking? |
| --- | --- | --- | --- | --- |
| User Content > Other User Content | questions, page text the user asks about, screenshots of the visible page (asked per site), coupon page text | App Functionality | No | No |
| Browsing History | address and title of the current page, and of open tabs only when the user turns on tab search | App Functionality | No | No |

Not declared, and why: the API key (a credential sent only to the user's own
provider to sign in, not a data type Apple lists); voice (the microphone uses
Safari's own speech recognition, handled by Apple, and Scout records nothing);
the debug log (kept on the device, never sent by the app; leaves only if the
user taps Copy debug log and pastes it somewhere themselves); coupon tests (sent to the store the user is already
on, from the user's own cart).

"Not linked" because Scout attaches no name, account or device ID, and has
no account of its own. If App Review disagrees, the alternative is "Linked to
you" (the provider ties requests to the user's API account); it is the same
two rows with that one answer changed.

## 4. Age rating (App Information > Age Ratings)

Answer the questionnaire as follows, then override.

- Every content question (profanity, horror, violence, mature themes,
  sexuality, medical or treatment information, health and wellness, alcohol
  and drugs, simulated gambling, contests, gambling, loot boxes): **None / No**.
  Scout makes no content of its own; answers come from the user's provider.
- In-app controls: Parental Controls **No**, Age Assurance **No**.
- Capabilities: Unrestricted Web Access **No** (Scout has no browser of its
  own; it runs inside Safari, which has its own restrictions), Messaging and
  Chat **No** (no person-to-person messages), User-Generated Content **No**
  (nothing is shared with other users), Advertising **No**.
- Social media questions (required since September 2026): **No** to all.
- Made for Kids: **No**.
- **Override to Higher Age Rating: 18+.** The published privacy policy says
  users must meet their AI provider's minimum age, and Anthropic's own terms
  require users to be 18. Apple says an app whose terms set a higher minimum age than
  the calculated rating must override to match.

## 5. App Review Information

- **Sign-in required:** No (there is no account). Leave user name and
  password empty.
- **Contact:** the owner's name, phone and email as App Review's private
  contact. This is not shown on the App Store.
- **Notes** (paste, then replace the bracketed key line):

> Scout AI Browser Assistant is a Safari web extension with a small host app. The
> host app shows how to turn the extension on; everything else happens in
> Safari.
>
> To try it:
> 1. Open the Scout app once. On iPhone/iPad turn Scout on in Settings > Apps
>    > Safari > Extensions (allow it on all websites). On Mac turn it on in
>    Safari > Settings > Extensions.
> 2. In Safari, open any article and tap Scout in the toolbar (on iPhone, in
>    the menu next to the address bar). Open Settings, choose Anthropic, and
>    paste this test key, then Test and save:
>    [TEST KEY: an Anthropic key with a low spending limit, pasted here by
>    the owner at submission and revoked after review]
> 3. Tap Summarize. Scout first asks permission to share with Anthropic;
>    nothing is sent before Allow (guideline 5.1.2(i)).
> 4. Scout mode: on a page with a form, ask Scout to fill it out. A glowing
>    border and a Stop button show while Scout works; it asks before buying,
>    signing in or sending anything.
> 5. Find coupons: on a store's cart or checkout page, tap + and Find coupons.
>    Scout searches for codes posted online, adds some common codes clearly
>    labeled as guesses, tries them in the store's own coupon box, and keeps
>    the best. It never places an order.
>
> No account, no Scout server, no analytics, no ads. Requests go from the
> device straight to the provider the user picked, with the user's own key;
> the user pays that provider. The key is not a purchase and unlocks no Scout
> feature; Scout is free, with no in-app purchases (3.1.1).
>
> Site access: Safari asks the user for access to websites; Scout reads a
> page only when the user asks about it or starts a task there (4.4.2).
>
> Scout is made by Rare Creatures LLC and is not affiliated with Anthropic
> or OpenAI.

- **Attachment:** optional. A short screen recording of steps 2 to 5 helps
  reviewers who can't get the extension turned on.

## 6. Other App Store Connect answers

| Question | Answer |
| --- | --- |
| Export compliance | Uses encryption only through the system's HTTPS: exempt (the Info.plist flag answers it on upload) |
| Content rights: contains, shows or accesses third-party content? | Yes: it reads web pages the user opens and shows AI answers about them. Confirm you have the rights to do so (like any browser extension). The owner attests to this, not Claude |
| Advertising identifier (IDFA) | No |
| Price | Free (Tier 0), no in-app purchases |
| Availability | All countries except China mainland (recommended: AI chat apps there need a government generative-AI approval Apple enforces) |
| Digital Services Act (EU) | Trader. As an Organization, the D-U-N-S address of the LLC is shown on EU product pages automatically, with a phone and email you enter. See checklist step 3 |
| Release | "Manually release this version", so an approval doesn't go live before you're ready |
| Phased release (iOS) | Off (it only matters for updates) |
| Medical device declaration | Not asked (only Health & Fitness / Medical categories) |

## 7. Screenshots

Apple requires at least one and up to ten per device size, PNG or JPEG with
no transparency (guideline 2.3.3: they must show the app in use).

| Device | Required? | Size to capture | Where from |
| --- | --- | --- | --- |
| iPhone | yes (6.1-inch Dynamic Island class) | 1206 x 2622 portrait | iPhone 17 Pro Simulator (`xcrun simctl io booted screenshot`) or the owner's iPhone |
| iPad | yes, because the app runs on iPad | 2064 x 2752 portrait | iPad Pro 13-inch Simulator |
| Mac | yes | 2880 x 1800 (16:10) | Safari on the Mac; crop or pad to 16:10 if the display isn't 16:10 |

Shot list, same five on each device, light appearance, default looks
(Trailhead on Mac, Pure Apple on iPhone and iPad):

1. Summary of an article (use a rarecreatures.app page, so no one else's
   content or brand is shown, guideline 5.2.1).
2. A question answered, with its source chips.
3. Scout mode filling the local forms fixture (`tests/fixtures/forms.html`),
   glow and Stop button visible.
4. Find coupons finished on the local shop fixture, showing the saving
   (no real store's brand).
5. The Scout app's setup screen.

Put them in `build/app-store-screenshots/iphone`, `ipad` and `mac`, then run
`npm run check:screenshots`; it names any wrong size, transparency or count.
These are taken in the combined Mac + iPhone device check, not by the owner by
hand.

**First release set (2026-10-23):** a designed set of five per device, made from
the release build's panel with synthetic pages and stores, is in the project files at
`app-store/screenshots/` (Mac 2880 x 1800, iPhone 1206 x 2622, iPad 2064 x 2752) with an
optional iOS header image in `app-store/header/`. The panels come from
`impeccable-review/tools/appstore.capture.ts`
(`npx playwright test -c impeccable-review/tools/appstore.config.ts`, after
`npm run build:release`); the layout and headlines are in `app-store/art-source/`. Real
device captures from the shot list above can replace them later.

Coming later: Apple will require iPhone Duo screenshots for every submission
from April 2027. Apple's new optional "creative assets" (guideline 2.3.14)
are not needed for the first release.

## 8. Risks App Review may raise, and where they stand

| Guideline | Risk | Status |
| --- | --- | --- |
| 5.1.2(i) third-party AI | data shared with AI without clear consent | Covered: consent dialog per provider before anything is sent, privacy policy names both providers, label declares the data, review notes say so |
| 5.1.1(i) privacy policy in app | link must be inside the app and easy to find | Fixed in this branch: the app's setup screen and the extension's Settings link to the published policy; the "DRAFT" legal pages are gone from both |
| 2.1 completeness | reviewers can't test without a key | The owner adds a capped test key to the notes at submission |
| 2.1 / 2.3 placeholder content | "draft" or UNKNOWN text visible in the app | Fixed in this branch (the bundled draft policy and terms are no longer in the app) |
| 4.4.2 Safari extensions | "should not claim access to more websites than strictly necessary" | Site access is optional and asked for only when the user turns it on; explained in the notes |
| 2.5.14 recording user activity | Scout mode screenshots and page reading | Clear on-screen glow and Stop button; screenshots asked per site |
| 5.2.2 third-party sites | trying coupon codes on stores whose terms may forbid automated entry, including guessed codes | Open: launch blocker 4 (merchant terms legal review). The owner's call before Submit |
| Private Browsing | consent text counsel reviewed said Scout is off in Private Browsing; it now works there | Open: launch blocker 34 (counsel). The owner's call before Submit |
| 2.3.10 other platforms | the panel's code carries Chrome and Firefox wording that Safari never shows | Low: nothing visible names them; the App Store text doesn't either |
| 5.2.1 / 4.1(c) names | "Safari" in the subtitle, the Mac app file still named "Scout for Safari.app" | Low: names the browser it works in; fallback subtitle in section 2; renaming the Mac file is a separate decision |
| 1.2 user-generated content | AI apps sometimes get asked about content filtering | Low: Scout shares nothing between users; 1.2 targets apps where users share content |

## 9. Owner's checklist

Only the owner can do these. Do them in order; nothing goes public until step 9.

**While waiting for the D-U-N-S letter**

1. Look at the address on the LLC's D-U-N-S record (Dun & Bradstreet's
   lookup, free). Apple shows that address publicly on EU product pages. If
   it's your home, change it with Dun & Bradstreet to a business or
   registered-agent address before converting, or tell me and I'll set the
   app to skip EU countries for now.
2. Pick the public phone and email for EU listings (for example
   hello@rarecreatures.app and a business number).

**When the letter arrives**

3. Request the conversion at developer.apple.com > Account > Membership (the
   "migrate individual account" request), with the D-U-N-S number. Apple may
   ask for business documents. When it's done, check that Account >
   Membership shows Rare Creatures LLC and that the team ID is still
   `KTV2G3Z883` (if it changed, tell the Mac builds thread; signing needs it).
4. In App Store Connect > Business, accept the latest agreements and declare
   trader status (Business > Digital Services Act). Apple says traders also
   enter payment account details if they haven't already, and verify the
   phone and email; a free app needs no tax forms.

**Build and upload** (the Mac builds thread runs this with you, one command
at a time)

5. Combined device check, then the Release archive and upload
   (`scripts/archive-testflight.sh`). This also confirms the Mac extension
   reads the saved key (launch blocker 14) and takes the screenshots in
   section 7.

**In App Store Connect** (all clicks are yours)

6. Apps > + > New App: platforms iOS and macOS, name "Scout AI Browser Assistant",
   bundle ID `com.harrisonfischberg.Scoutai`, SKU `scout-ai-assistant`,
   primary language English (U.S.).
7. Fill in sections 2 to 6 of this document, upload the screenshots, and pick
   the uploaded build for each platform.
8. Create an Anthropic test key with a low spending limit (for example $10),
   paste it into the review notes, and plan to revoke it after review.
9. Decide launch blockers 4 and 34 (or accept them as they are), then press
   **Add for Review** and **Submit**, once for iOS and once for macOS.
10. When approved, press **Release** on each platform.

## Sources (read 2026-10-20)

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (Last Updated October 16, 2026)
- [Updated App Review Guidelines, November 2025](https://developer.apple.com/news/?id=ey6d8onl) (5.1.2(i) third-party AI)
- [Apple Developer News](https://developer.apple.com/news/) (SDK minimums, social media age questions, iPhone Duo screenshots)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Age ratings values and definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions) and [Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/)
- [App Privacy Details](https://developer.apple.com/support/app-privacy-on-the-app-store/)
- [EU Digital Services Act trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/)
- [Updating your account information](https://developer.apple.com/help/account/membership/updating-your-account-information/) (individual to organization)
- [Developer forum: rejections over third-party AI](https://developer.apple.com/forums/thread/815842)
