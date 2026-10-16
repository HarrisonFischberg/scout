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
| 9 | `xcodebuild` and `swiftc` cannot write build output or module cache under the session sandbox (EPERM on `Logs/Build/LogStoreManifest.plist`, tried DerivedData in `~/Library`, `$TMPDIR`, `/tmp/claude`, and repo `build/`). Needs owner to run the Xcode builds outside the sandbox or approve a writable path | tool | owner | T002 `xcodebuild` verification; every later Xcode build and XCTest task | open (T002 blocked) |
| 10 | Safari runtime load cannot run here: CoreSimulatorService is not running (no iOS Simulator runtime or devices), and Launch Services (`open`) is blocked. Needs owner to start a simulator and load the extension in Safari macOS | tool | owner | T002 acceptance (extension loads); T006, T007, T018 | open (T002 blocked) |
| 11 | Bundle identifier is a placeholder: `com.example.AssistAnt` (app) and `com.example.AssistAnt.Extension`. Owner must choose the reverse-DNS prefix before signing or the App Store | missing fact | owner | Apple Developer signing; App Store | open; placeholder in `apple/AssistAnt.xcodeproj` |

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
