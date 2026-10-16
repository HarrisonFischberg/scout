# Launch blockers

| # | Blocker | Type (missing fact / failed check / legal review / approval) | Owner | Needed for | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Business/legal inputs below are UNKNOWN | missing fact | owner | privacy policy, terms, App Store listing | open |
| 2 | Apple Developer Program membership (paid) for device signing + App Store | approval (paid account) | owner | iOS device testing, TestFlight, release | open |
| 3 | Test API keys for Anthropic and OpenAI (owner-provided, low spend limit) | missing credential | owner | live provider integration tests | open; mocked until then |
| 4 | Merchant terms: automated coupon trying may breach some retailers' terms; bot detection may block | legal review | owner + counsel | F06 release | open |
| 5 | AI provider usage policies for agentic browsing / user age requirements | legal review | owner | safeguard 17, terms | open |
| 6 | `/goal` and Ralph loop | tool | Claude | Phase 4 | resolved 2026-10-15 |
| 7 | REA web capture needs a CDP browser started with approval | tool | owner | further reference capture (optional) | open |
| 8 | Privacy policy + terms drafts need qualified legal review | legal review | owner | release | open |
| 9 | `xcodebuild` and `swiftc` cannot write build output or module cache under the session sandbox (EPERM on `Logs/Build/LogStoreManifest.plist`, tried DerivedData in `~/Library`, `$TMPDIR`, `/tmp/claude`, and repo `build/`). Needs owner to run the Xcode builds outside the sandbox or approve a writable path | tool | owner | T002 `xcodebuild` verification; every later Xcode build and XCTest task | open (T002 blocked). Re-checked 2026-10-15 19:42 and 19:45 in `/goal` runs: `xcodebuild` still fails under DerivedData (EPERM, then `simdiskimaged` and no Simulator runtimes); see `activity.md` |
| 10 | Safari runtime load cannot run here: CoreSimulatorService is not running (no iOS Simulator runtime or devices), and Launch Services (`open`) is blocked. Needs owner to start a simulator and load the extension in Safari macOS | tool | owner | T002 acceptance (extension loads); T006, T007, T018 | open (T002 blocked) |
| 11 | Bundle identifier is a placeholder: `com.example.AssistAnt` (app) and `com.example.AssistAnt.Extension`. Owner must choose the reverse-DNS prefix before signing or the App Store | missing fact | owner | Apple Developer signing; App Store | open; placeholder in `apple/AssistAnt.xcodeproj` |
| 12 | Playwright WebKit cannot launch under the session sandbox (`sandbox_extension_issue_file_to_process failed ... Playwright.app: Operation not permitted`, then `browserType.launch` timeout). Needs owner to run `npm run e2e` outside the sandbox | tool | owner | T003 e2e verification; every later `npm run e2e` task (T007 re-hit 2026-10-15, T009 re-hit 2026-10-15 20:2x: 6 failed at WebKit launch; T010 re-hit 2026-10-15 20:3x: agent spec timed out at launch; T011–T013, T015) | open (T003 needs supervised check) |
| 13 | T004 Swift side is written but unbuilt: sandbox blocks `xcodebuild`/`swiftc`, and the Xcode project has no XCTest target. Supervised session must add a macOS unit-test bundle (sources: `apple/Extension/KeychainStore.swift`, `apple/Tests/KeychainStoreTests.swift`), then run `xcodebuild test`. Keychain access in a test host may need a keychain entitlement or a signed host | tool | owner (supervised session) | T004 `xcodebuild test` verification | open (T004 needs supervised check) |
| 14 | T006 Swift side is written but unbuilt (same sandbox limit as 9). Open design issue: host app and extension must read the same Keychain item. `KeychainStore.accessGroup` is nil, so each target uses its own default keychain access group and the extension may not see the key the app saved. Supervised session must add a shared Keychain access group entitlement to both targets (needs a team ID, see 2) and pass it to `KeychainStore`. Also add `apple/Tests/ProviderSetupTests.swift` to the unit-test bundle (blocker 13) and run Accessibility Inspector on S01-S03 with screenshots in `ralph/evidence/` | tool + approval | owner (supervised session) | T006 `xcodebuild test`, screenshots, VoiceOver check; T007 key read by the extension | open (T006 needs supervised check) |

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
