# Launch blockers

| # | Blocker | Type (missing fact / failed check / legal review / approval) | Owner | Needed for | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Business/legal inputs below are UNKNOWN | missing fact | owner | privacy policy, terms, App Store listing | open |
| 2 | Apple Developer Program membership (paid) for device signing + App Store | approval (paid account) | owner | iOS device testing, TestFlight, release | open |
| 3 | Test API keys for Anthropic and OpenAI (owner-provided, low spend limit) | missing credential | owner | live provider integration tests | partly resolved 2026-10-15: owner Anthropic test key verified live (F02–F07). OpenAI key not yet saved; OpenAI live path unverified |
| 4 | Merchant terms: automated coupon trying may breach some retailers' terms; bot detection may block | legal review | owner + counsel | F06 release | open. Owner product decision 2026-10-16: test as many codes as possible, guesses included ("no harm in testing"); batches of 25 with a prompt; store cart endpoint on Shopify; 250 ms pause between codes; stop on 429 / CAPTCHA. Legal review of merchant terms still required before release |
| 5 | AI provider usage policies for agentic browsing / user age requirements | legal review | owner | safeguard 17, terms | open |
| 6 | `/goal` and Ralph loop | tool | Claude | Phase 4 | resolved 2026-10-15 |
| 7 | REA web capture needs a CDP browser started with approval | tool | owner | further reference capture (optional) | open |
| 8 | Privacy policy + terms drafts need qualified legal review | legal review | owner | release | open |
| 9 | `xcodebuild` and `swiftc` cannot write build output or module cache under the session sandbox (EPERM on `Logs/Build/LogStoreManifest.plist`, tried DerivedData in `~/Library`, `$TMPDIR`, `/tmp/claude`, and repo `build/`). Needs owner to run the Xcode builds outside the sandbox or approve a writable path | tool | owner | T002 `xcodebuild` verification; every later Xcode build and XCTest task | resolved for supervised work: Xcode builds/tests run in the supervised session (CLAUDE.md). Still true inside the Ralph loop sandbox |
| 10 | Safari runtime load cannot run here: CoreSimulatorService is not running (no iOS Simulator runtime or devices), and Launch Services (`open`) is blocked. Needs owner to start a simulator and load the extension in Safari macOS | tool | owner | T002 acceptance (extension loads); T006, T007, T018 | resolved 2026-10-15: dedicated simulator "Safari Scout Test iPhone"; extension loaded and driven live |
| 11 | Bundle identifier is a placeholder: `com.example.AssistAnt` (app) and `com.example.AssistAnt.Extension`. Owner must choose the reverse-DNS prefix before signing or the App Store | missing fact | owner | Apple Developer signing; App Store | open; placeholder in `apple/SafariScout.xcodeproj` |
| 12 | Playwright WebKit cannot launch under the session sandbox (`sandbox_extension_issue_file_to_process failed ... Playwright.app: Operation not permitted`, then `browserType.launch` timeout). Needs owner to run `npm run e2e` outside the sandbox | tool | owner | T003 e2e verification; every later `npm run e2e` task (T007 re-hit 2026-10-15, T009 re-hit 2026-10-15 20:2x: 6 failed at WebKit launch; T010 re-hit 2026-10-15 20:3x: agent spec timed out at launch; T011 re-hit 2026-10-15 20:3x: safety spec, 5 did not run at launch; T012 re-hit 2026-10-15 20:3x: tabs spec, 3 did not run at launch; T013 re-hit 2026-10-15 21:0x: coupons spec, 1 did not run at launch; T015 re-hit 2026-10-15 21:1x: settings spec, 3 did not run at launch) | resolved for supervised work: e2e runs outside the sandbox (42/42). Still true inside the loop sandbox |
| 13 | T004 Swift side is written but unbuilt: sandbox blocks `xcodebuild`/`swiftc`, and the Xcode project has no XCTest target. Supervised session must add a macOS unit-test bundle (sources: `apple/Extension/KeychainStore.swift`, `apple/Tests/KeychainStoreTests.swift`), then run `xcodebuild test`. Keychain access in a test host may need a keychain entitlement or a signed host | tool | owner (supervised session) | T004 `xcodebuild test` verification | resolved 2026-10-15: SafariScoutTests target added; XCTest 11/11 |
| 14 | T006 Swift side is written but unbuilt (same sandbox limit as 9). Open design issue: host app and extension must read the same Keychain item. `KeychainStore.accessGroup` is nil, so each target uses its own default keychain access group and the extension may not see the key the app saved. Supervised session must add a shared Keychain access group entitlement to both targets (needs a team ID, see 2) and pass it to `KeychainStore`. Also add `apple/Tests/ProviderSetupTests.swift` to the unit-test bundle (blocker 13) and run Accessibility Inspector on S01-S03 with screenshots in `ralph/evidence/` | tool + approval | owner (supervised session) | T006 `xcodebuild test`, screenshots, VoiceOver check; T007 key read by the extension | iOS resolved 2026-10-15: shared group `$(AppIdentifierPrefix)com.example.AssistAnt.shared` (apple/iOS-Shared.entitlements); verified on Simulator with a DEBUG-seeded synthetic key (popup showed "Ready"). macOS still open: needs provisioning profile / team (blocker 2) |
| 15 | T013 coupon codes come from model suggestions, not a live web search: the provider layer has no web-search tool (Anthropic server web search / OpenAI web search not wired). PRD feature 4 says "web search for codes". Needs owner decision to add the provider search tool (live keys, blocker 3, to verify) before claiming search. Until then UI says "model suggestions, not a live web search" | missing capability | owner + build | F06 claims (safeguard 12) | T019 wired provider web search (unit-tested with mocked streams; every tried code has a source URL). Still open: coupons e2e in WebKit (blocker 12) and one live check with owner test keys (blocker 3) that Anthropic `web_search_20250305` / OpenAI `web_search` accept the request shape and model/plan; tool type string may need updating | resolved in code by T019 (codes need a source URL from provider web search). Live search against a real merchant with public codes not yet run |

## Unknown business and legal inputs

Never infer these from a reference app. Never invent them.

- Legal entity and trading name: UNKNOWN
- Business location: UNKNOWN
- Launch countries/states: UNKNOWN
- Public business contact: UNKNOWN
- Privacy contact: UNKNOWN
- Minimum user age / children may use: UNKNOWN
- Pricing, billing, trials, renewal: UNKNOWN (BYOK: provider bills the user for API usage separately)
- Refund and cancellation terms: UNKNOWN
- Data types and sensitive data: page content (may include personal, financial, health data the user views), API key. See `data-inventory.md`.
- Vendors, SDKs, analytics, AI providers, processors: Anthropic, OpenAI (user-chosen). No analytics planned.
- Retention or deletion exceptions: UNKNOWN

16. OpenAI model price missing. `src/cost.ts` has no price for `gpt-5`; the UI shows tokens and "Cost estimate unavailable". Owner or supervised session: read https://developers.openai.com/api/docs/pricing, add the row with source and date to `PRICES`, and update `docs/claims-evidence.md`. Also re-check the Anthropic row before release; prices change.

17. T017 a11y audits not run: web-quality-audit (needs a browser, blocker 12) and Accessibility Inspector on SwiftUI (supervised GUI session, blocker 14). Safeguard rows 13, 14, 15 stay NEEDS REVIEW. Rows 3, 16, 17 wait on owner facts (blockers 1, 5). Owner or supervised session: run both audits and update `docs/compliance-checklist.md`.

18. T018 manual verification of F01-F07 not run. Task is manual-only: sandbox cannot launch Safari macOS or the iOS Simulator (blockers 9, 10) and `xcrun` is forbidden in the loop. Owner or supervised session: run each flow on Safari macOS and iOS Simulator, save one screenshot per flow in `ralph/evidence/` (`xcrun simctl io booted screenshot <file>`), log failures as bugs. Flows with unrun e2e (coupons, settings, blocker 12) and unfilled a11y audits (blocker 17) should be covered first.

19. T020 host-app legal screen is written but unbuilt: `apple/App/OnboardingView.swift` reads `privacy-policy.md` and `terms.md` from the app bundle, but the Xcode project does not copy `docs/legal/*.md` into the App targets' Resources yet (shows "This draft is not bundled in this build." until then). Supervised session: add both files to the App (macOS) and App (iOS) Resources phases, build, check keyboard/VoiceOver reach of the two buttons. Also run `npx playwright test settings` outside the sandbox (blocker 12) to run the new legal-links spec.


## Added 2026-10-15 (T018 live verification)

| # | Blocker | Type | Owner | Needed for | Status |
| --- | --- | --- | --- | --- | --- |
| 16 | OpenAI default model `gpt-5` and its price are unverified against OpenAI docs; cost estimate withheld | missing fact | owner + Claude | OpenAI path, safeguard 10 | open |
| 17 | iOS Safari cannot read background tabs, so @tab works only on macOS; disclosed in the conversation | platform limit | owner (product decision) | F04 on iOS, listing claims | open |
| 18 | macOS Safari flows F02–F07 not driven live (only extension load) | verification | owner manual or supervised | Gate A | open |
| 19 | App and extension icons are Xcode placeholders | asset | owner | release, safeguard 19 | resolved in engineering 2026-10-16: original binoculars artwork for toolbar, extension, macOS and iOS app icons (replaced the earlier ant artwork) |
| 20 | Safari-granted site access cannot be revoked by the extension on iOS; Delete all data tells the user where to remove it | platform limit + legal review | owner + counsel | safeguard 20 wording | open |

| 21 | Name "Safari Scout" contains Apple's trademark "Safari". App Store Review Guidelines limit use of Apple trademarks in app names and may reject it; trademark search also needed for "Safari Scout" itself | legal review | owner + counsel | App Store submission, any public listing | open (added 2026-10-16 with the rename) |
