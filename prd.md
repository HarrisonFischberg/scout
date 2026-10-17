# Scout for Safari — PRD

Status: APPROVED by owner 2026-10-15 (chat). Build with mocked AI providers until test keys are supplied.

## Purpose

Scout for Safari: a Safari toolbar AI assistant and supervised browser agent for
macOS and iOS. The user brings their own Anthropic or OpenAI API key.

## Product features (MVP = all `must` rows in `replica/features.csv`)

1. Host app (SwiftUI, macOS + iOS): enable-extension onboarding, provider +
   API key setup stored in Keychain, settings, legal pages.
2. Toolbar popup chat: ask about the current page, summarize, ask across
   tabs (@tab), streamed Markdown answers.
3. Agent mode: structured page snapshot; tools for click, type, select,
   scroll, navigate, wait, web search; visible plan and step list;
   Pause/Stop; approval sheet before sensitive actions.
4. Coupon finder: web search for codes for the current merchant, try each
   code one at a time, read the cart total after each, keep the best, stop
   before the order. Shows every attempt and its real result.
5. Cost transparency: token usage and estimated provider cost per run.
6. Privacy: no Scout for Safari server, no analytics; history retention setting;
   Delete all data.

## Architecture (recommended)

- Xcode multiplatform "Safari Extension App" (macOS + iOS targets) — same
  shape SafarAI uses (REA finding 1). All code original.
- Extension written in TypeScript, bundled by esbuild into the extension's
  `Resources/`. Background (non-persistent) runs the agent loop; content
  script builds page snapshots and performs actions; popup is the UI.
- Providers behind one interface: Anthropic Messages API (tool use, server
  web-search tool) and OpenAI Responses API (function calling, web search).
  Model IDs confirmed with the `claude-api` skill and OpenAI docs at build
  time; default Claude Sonnet 5.5, user-selectable.
- Spec Part 2 (2026-10-16): chat answers run in the background worker as the
  "Scout server" (`src/server/`), streamed to the popup over the `scout-panel`
  port with numbered events; the popup gathers context and runs tool requests
  through the worker's tool host and permission gate. No hosted server.
- Native messaging (`SafariWebExtensionHandler`) for Keychain read/write.
  The key never enters `storage.local`, logs, or model prompts.
- Permissions: `activeTab`, `tabs` (T012: titles/URLs for the @tab picker), `storage`,
  `scripting`, `nativeMessaging`, `contextMenus`; host access requested per site, not `<all_urls>` up front.
- Safety layer: page text wrapped as untrusted data in prompts; an allowlist
  of tool actions; classifier rules mark sensitive actions (payment/order
  submit, login/password fields, send/post, personal-data form submit,
  downloads) as approval-required; hard stop at CAPTCHAs; per-run step and
  token budget.
- Testing: Vitest (unit), Playwright WebKit against local fixture pages
  (fake shop with coupon form, forms, injection page), `xcodebuild` build +
  XCTest for Swift, manual Safari macOS + iOS Simulator checks with
  screenshots. Provider calls mocked in tests; live calls only with
  owner-provided test keys.

## REA and Replica findings

See `docs/rea-findings.md` and `replica/` (recon map, feature matrix,
intentional differences).

## Atomic tasks

Status values: `pending`, `in progress`, `done`, `blocked`, `needs supervised check` (implemented and JS-verified; Xcode/XCTest/Simulator verification left to the supervised session), `owner` (owner action, not a loop task). For dependency purposes, `needs supervised check` counts as satisfied.

| ID | Task | Depends on | Acceptance criteria | Verification command | Status |
| --- | --- | --- | --- | --- | --- |
| T001 | Visual direction via `ui-ux-pro-max`; tokens + component specs in `replica/design.md`; contrast checked | — | Light + dark tokens; every text/control pair ≥ WCAG AA per Replica contrast tool | Replica contrast checker output saved to `replica/contrast.txt` | done |
| T002a | Xcode multiplatform Safari extension project; esbuild TS pipeline; Safari API support table from MDN compat data | — | Both targets build; `npm run build` emits extension into `apple/Extension/Resources`; `docs/safari-api-support.md` exists | `npm run build`; `xcodebuild -project apple/SafariScout.xcodeproj -scheme "Scout for Safari (macOS)" -derivedDataPath build/DD CODE_SIGNING_ALLOWED=NO build`; same for `"Scout for Safari (iOS)" -destination 'generic/platform=iOS Simulator'` (supervised) | done (supervised 2026-10-15: both BUILD SUCCEEDED, see activity.md) |
| T002b | Load the extension in Safari macOS and the iOS Simulator; runtime-verify the API support table | T002a | Extension appears and its popup opens in both; table's Runtime-verified column filled | owner manual check + screenshots in `ralph/evidence/` | owner — load PASS on macOS + iOS Simulator (owner-reported popup; iOS enabled-state screenshot `ralph/evidence/T002b-ios-extension-enabled.png`); runtime API column still open, to be filled during T004/T007/T012 supervised checks |
| T003 | Test harness: Vitest, Playwright WebKit, local fixture site (shop, forms, injection page), lint, typecheck | T002a | `npm test`, `npm run e2e`, `npm run lint`, `npm run typecheck` all run green on a trivial test | those commands | done (supervised 2026-10-15: typecheck, lint, 82 unit, 24/24 WebKit e2e pass outside sandbox) |
| T004 | Keychain bridge via native messaging (set/get/delete key) | T002a | XCTest covers set/get/delete; JS never persists key; grep finds no key in storage | `xcodebuild test`; `npm test -- keychain` | done (supervised 2026-10-15: XCTest SafariScoutTests 4/4 Keychain tests pass; `npm test -- keychain` pass; no `storage.*.set` anywhere in src/) |
| T005 | Provider layer: Anthropic + OpenAI adapters, streaming, tool calls, error mapping (401, 429, network), token usage | T003 | Unit tests with recorded fixtures pass for both providers; errors map to user messages | `npm test -- providers` | done (18 provider tests pass; see activity.md) |
| T006 | Host app onboarding + key setup screens (S01–S03), VoiceOver labels | T001, T004 | Screens render light/dark; Test key button shows valid/invalid; Accessibility Inspector no errors | `xcodebuild test` + screenshots in `ralph/evidence/` | blocked (partial). Done 2026-10-15 supervised: iOS XCUITest `performAccessibilityAudit` passes on setup screen in light and dark (dark verified by pixel check) and on the legal sheet; screenshots `ralph/evidence/T006-ios-*.png`; fixes: contrast (accent-text tint, token-paired AccentButtonStyle), clipped status text, sheet close control, raw Markdown. Still open: shared Keychain access group needs Apple team ID (blockers 2, 14); macOS host app visual + Accessibility Inspector check (owner manual) |
| T007 | Popup chat (S04): page Q&A, summarize, streaming, no-key + error states, keyboard operable | T001, T005 | Playwright: ask + summarize on fixture page with mocked provider; keyboard-only path passes | `npm run e2e -- chat` | done (supervised 2026-10-15: e2e chat specs pass in WebKit) |
| T008 | Page snapshot builder: text + interactive elements with stable refs; redact password/card/CVV fields | T003 | Unit tests: redaction verified; snapshot under size budget on large fixture | `npm test -- snapshot` | done (6 snapshot tests pass; see activity.md) |
| T009 | Action executor: click/type/select/scroll/navigate/wait by ref; result reporting | T008 | Playwright on fixtures: each action succeeds; missing ref fails cleanly | `npm run e2e -- actions` | done (supervised 2026-10-15: e2e actions specs pass in WebKit) |
| T010 | Agent loop: plan, step list UI (S05), budgets, Pause/Stop | T005, T007, T009 | E2E with scripted mock model completes a 5-step form task; Stop halts within one step | `npm run e2e -- agent` | done (supervised 2026-10-15: e2e agent specs pass after fixing a test race; Stop verified mid-run) |
| T011 | Safety layer: sensitive-action classifier + approval sheet (S06), CAPTCHA stop, untrusted-content wrapping | T010 | E2E: order-submit, login, and send are blocked until approved; injection fixture cannot trigger an unapproved action | `npm run e2e -- safety` | done (supervised 2026-10-15: e2e safety specs pass, incl. CAPTCHA stop and injection page) |
| T012 | @tab multi-tab context | T007 | E2E: answer cites content from 2 selected fixture tabs | `npm run e2e -- tabs` | done (supervised 2026-10-15: e2e tabs specs pass in WebKit) |
| T013 | Coupon finder (F06): search codes, try 1×1, parse totals, keep best, never click order (S07) | T010, T011 | E2E on fixture shop with 5 codes (2 valid, different %): best one applied, all attempts listed with real totals, order button never clicked | `npm run e2e -- coupons` | done (supervised 2026-10-15: coupons e2e passes in WebKit — best code kept, all attempts listed, "Place order" never clicked). Gap: codes come from model suggestions, no live web search; tracked as T019 (launch-blockers 15) |
| T014 | Cost display: tokens + estimated cost per run, price table dated and sourced | T005 | Unit test on cost math; price source recorded in `docs/claims-evidence.md` | `npm test -- cost` | done (4 cost tests pass; see activity.md; gpt-5 price unsourced, estimate withheld, launch-blockers 16) |
| T015 | Settings (S08): provider/model, retention, per-site access, Delete all data | T004, T007 | E2E: Delete all data clears storage and Keychain item; retention expiry unit-tested | `npm run e2e -- settings`; `xcodebuild test` | done (supervised 2026-10-15: settings e2e 3/3 pass in WebKit; XCTest 8/8 pass) |
| T016 | Draft privacy policy + terms (S09) from data inventory; marked DRAFT for legal review | T015 | Every data-inventory row reflected; UNKNOWN facts marked, not invented | manual review checklist in `docs/compliance-checklist.md` | done (drafts in `docs/legal/`, marked DRAFT; qualified legal review is launch-blocker 8; in-app S09 screen tracked as T020) |
| T017 | Safeguards sweep: fill all 20 rows; a11y audits (web-quality-audit on popup pages, Accessibility Inspector on SwiftUI) | T006–T016 | Each row has status + evidence path; no PASS without evidence | `docs/compliance-checklist.md` review | done (supervised 2026-10-15: every row re-checked against repo evidence; 7 PASS, 2 NOT APPLICABLE, 2 BLOCKED, 9 NEEDS REVIEW at T017; row 20 moved PASS → NEEDS REVIEW after T018 (now 6 PASS, 10 NEEDS REVIEW). Fixes during review: upfront provider-billing disclosure (row 10), readable coupon status text, dark legal-link contrast. Lighthouse not run (unavailable); axe-core in WebKit used. Remaining items listed per row) |
| T018 | iOS Simulator + Safari macOS manual verification of F01–F07 with screenshots | T017 | Screenshot per flow in `ralph/evidence/`; failures logged as bugs | manual + `xcrun simctl io booted screenshot` | blocked (partial). Live on iOS Simulator with owner test keys, 2026-10-15: F02 ask, F03 summarize, F05 agent (fills form, stops at approval, honors Deny), F06 coupon finder (no sourced codes → tries none, says so), F07 delete — all PASS with Anthropic. Found + fixed 8 defects (see activity.md). Still open: F04 cross-tab on iOS (Safari cannot read background tabs; now disclosed), OpenAI live path (owner key not saved due to host-app status bug, now fixed), macOS Safari flows, F06 with a merchant that has real public codes |
| T019 | Wire provider web search into the coupon finder: Anthropic server web-search tool and OpenAI web search; mark each code with its source URL; never present a model-invented code as found | T013 | Unit + e2e with recorded (mocked) search results: every tried code has a source URL; with search disabled, the finder says it has no sourced codes instead of guessing | `npm test -- coupons`; `npx playwright test coupons` | done (supervised 2026-10-15: 114 unit incl. "never tries a candidate without a source URL" and "says nothing was found instead of guessing"; coupons e2e passes in WebKit. Mocked search only: live provider search unverified until owner test keys, blocker 3) |
| T020 | In-app legal screen (S09): show privacy policy + terms drafts from `docs/legal/` in popup settings and host app, marked DRAFT until legal review | T016 | Links reachable by keyboard from S08 and host app; e2e opens both | `npx playwright test settings` | done (supervised 2026-10-15: settings e2e "legal drafts open ... by keyboard and are marked DRAFT" passes after fixing route scope; macOS + iOS builds succeed; host-app S09 sheet visual check is part of T006/T018) |
| T021 | Chat-first popup redesign (owner request 2026-10-16, Comet assistant used as layout reference only): minimal header (binoculars, New chat, Settings), chat fills the panel, composer pinned at bottom, Safari-native look in light and dark | T020 | axe WCAG 2.2 AA passes light + dark; keyboard walk passes; screenshots reviewed | `npx playwright test`; `node scripts/screenshot-popup.mjs` | done (supervised 2026-10-16) |
| T022 | Composer: + menu (Summarize page, Find coupons, Use other tabs) with Escape + focus return; autosizing input | T021 | e2e: menu opens by keyboard, Escape closes and refocuses + | `npx playwright test redesign` | done |
| T023 | Mode switch Chat / Control Browser; Control Browser shows a bold chip in the input and sends as a task | T021 | e2e: chip visible + bold, Start task replaces Send, only selected mode highlighted | `npx playwright test redesign` | done |
| T024 | Settings view inside the popup: provider, API key Test and save (Keychain via native messaging, never storage), Remove key, model, history, site access, diagnostics, legal, delete all; saves on change, applies without reopening | T021 | e2e: bad key explained, 401 rejected, good key saved to Keychain only; settings persist; Escape returns focus | `npx playwright test redesign settings` | done |
| T025 | Saved conversation restored on reopen; New chat starts fresh; Clear chat history | T021 | e2e: reload restores; New chat clears and stays cleared | `npx playwright test redesign` | done |
| T026 | Control Browser research: agent may use provider web search (`web_search_20260209`), results treated as untrusted, sources cited | T010 | unit: webSearch + research note only when enabled | `npm test -- agent` | done (live research run not yet verified) |
| T027 | Mac host app: key entry moved to the Safari popup (app and extension do not share a Keychain on Mac yet) | T024 | macOS build ok; iOS keeps in-app key entry | xcodebuild macOS | done |
| T028 | In-page side panel on macOS (owner idea: UI merged into the Safari page) | T021 | owner decision pending | — | proposed |
| T029 | Answer formatting (owner report 2026-10-16: Fox News page showed `Summary (from *title*)` with raw asterisks): renderer supports italics, bold italic, strike, h1–h6, quotes, tables, nested lists, rules, URLs with parentheses; prompt rules for clean, attributed, neutral answers without title labels; thread stays pinned to the newest message | T021 | unit: Fox News case renders italic; formatting rules in system prompt; e2e: restored conversation and growing composer keep newest in view, reading position respected | `npm test`; `npx playwright test redesign` | done (live re-check on the Fox News page pending) |
| T030 | Host app icon (owner report: blank square in Command-Tab): asset catalog with AppIcon for macOS (all sizes) and iOS (opaque 1024) from the binoculars artwork | — | macOS bundle has AppIcon.icns + Assets.car; iOS bundle has AppIcon PNGs | xcodebuild macOS + iOS | done (Command-Tab not yet seen on owner's Mac) |
| T031 | Coupon finder v2 (owner bug report 2026-10-16: getbeefy.co, 0 codes; Comet found 35 and saved 15%). Expected (owner): scan the web, find as many codes as possible, test them; after 25 ask to try more. Deep search (8 searches + web fetch), hints, labeled pattern guesses, Shopify cart endpoint fast path, batches of 25 with prompt, apply best + reload, Comet-style summary | T019 | unit: patterns, merge, labels, batches, Shopify apply/restore/rate-limit, summary; e2e: content script against fake Shopify cart; popup batch prompt for win and no-win | `npm test`; `npx playwright test cart coupons` | done (live re-run on getbeefy.co pending) |
| T032 | Button on webpages (owner request 2026-10-16; iOS Safari has no API to put an extension button beside the address bar): opt-in Scout tab on the page edge (60 x 64 awake, 32 px target tucked) that can be dragged up, down, or to the other side; tap opens Scout's toolbar panel through `action.openPopup` (Safari's half-height sheet over the page on iPhone, expandable). No extension page in websites (owner bug 2026-10-16: an in-page sheet crashed the page on iPhone). Runs only on granted sites, never in Private Browsing | T021 | unit: settings parsing, match patterns, openPanel, no web_accessible_resources; e2e: tap opens the panel with no frame in the page, size, drag + arrow keys save position, setting on/off, synthetic click ignored, Settings asks for site access | `npm test`; `npx playwright test edge` | built; unit, e2e 84/84, XCTest; iOS Simulator: tab opens Scout's panel, no crash; iPhone install pending owner check |

| T033 | Spec Part 2 §5: Scout server in the background worker (`src/server/engine.ts`, protocol `src/server/protocol.ts`): numbered events, tool requests by request_id, resume after a dropped port without duplicates, Stop, Continue after a provider drop; answers saved by the worker. No hosted server (owner approved 2026-10-16). Mock server `scripts/mock-scout-server.mjs` (local fake Anthropic stream: text, tool request, drop, slow) for e2e and debug builds | T021 | unit: events, tool round trip, timeout, resume, Stop, interrupted; e2e: tool mid-stream continues, dropped port resumes with no duplicate text, provider drop + Continue, Stop | `npm test`; `npx playwright test part2` | done (supervised 2026-10-16: unit 282/282, e2e 101/101 in WebKit; checked in Safari on the iOS Simulator with the mock server, see activity.md; real iPhone and Mac not checked, blocker 24) |
| T034 | Spec Part 2 §5: conversation store keyed by message id (pending → streaming → complete / error); rendering adds math (MathML), numbered citations [n], code language + Copy | T033 | unit: store transitions, duplicates ignored, gaps resubscribe; renderer parses math but not prices; e2e: table, code Copy, math, source link | `npm test`; `npx playwright test part2` | done (supervised 2026-10-16) |
| T035 | Spec Part 2 §6: cleaned Markdown + metadata, never raw HTML; form values, password and hidden inputs stripped; secrets and secret URL parameters redacted; 8 s per page, 12 s per request, partial allowed; attach-tab picker (+ menu list, @ suggestions, chips); "Shared:" line under each message, saved with history | T033 | unit: redaction, timeouts, blocklist before any script runs; e2e: only the current tab unless attached, @ attaches only when chosen, chips, shared line | `npm test`; `npx playwright test tabs part2` | done (supervised 2026-10-16) |
| T036 | Spec Part 2 §7: tool host with fixed allow-list (read_page, search_tabs, screenshot_visible, open_tab, close_tabs, group_tabs, ungroup_tabs, run_task stub), unknown names → schema-error, every call logged (tool, site, duration, status), close_tabs confirmation; Settings > Activity | T033 | unit: allow-list, input checks, logging, confirmation; e2e: unknown tool rejected and listed in Activity, close_tabs cancel closes nothing | `npm test`; `npx playwright test part2` | done (supervised 2026-10-16). Tab groups and history unsupported in Safari (blocker 25) |
| T037 | Spec Part 2 §10a: permission gate on the device: read current page (on), tab/history search (off), screenshots asked per site, user blocklist, organization blocklist (managed `ScoutBlockedSites`, `ManagedPolicy.swift`); blocked sites never read or screenshotted (`blocked-by-user`) | T036 | unit + XCTest; e2e: blocked site never read or screenshotted, Settings block, org list shown and enforced, search off does nothing, screenshot asks; axe light + dark | `npm test`; `npx playwright test part2`; `xcodebuild test` | done (supervised 2026-10-16: XCTest 21/21). Real MDM profile not tested (blocker 26) |
| T038 | Part 2 disclosures: consent wording v2 (`CONSENT_VERSION` 2, asks again), data inventory, privacy policy draft, API support table, launch blockers 23–27 | T033–T037 | every new flow has a data-inventory row | review | done; counsel review of v2 wording open (blocker 23) |
| T039 | Coupon finder v3 (owner report 2026-10-16: tackform.com checkout, "Find coupons" failed although public codes save 10%+). Expected (owner): finding coupons works on any checkout site, using codes found on the web. Search turns paused by the API (`pause_turn`) are resumed; a failed or slow search keeps what it found and the run goes on with codes the store advertises on its own site and guesses; code lines in Markdown, tables or lists are read; codes quoted in citations count as sourced; the summary says why a search failed | T031 | unit: pause/resume request shape, resume limit, no resume after Stop, lenient parsing, store-banner codes, search errors and timeout; e2e: failed search still tests guesses, store home page codes (not scripts), mock coupon search pauses and resumes | `npm test`; `npx playwright test coupons cart` | done in code; Simulator: real tackform.com checkout, STREETDEALX (Wethrift) took $110.00 to $99.00 with the mock search. Live web search with a real key open (blocker 28) |
| T040 | Coupon finder on any checkout (owner 2026-10-16: "It needs to work on every single website I go to"). Cart APIs for WooCommerce (Store API, nonce) and BigCommerce (Storefront API) beside Shopify; page path for every other store: opens a coupon box hidden behind a toggle or a collapsed order summary, waits for the store (message or a total that holds, up to 8 s) instead of a fixed 0.4 s, reads store error messages (several languages), takes a working code off before the next so stacked codes are measured alone (stops cleanly when no safe remove button exists), reads totals in any common currency and format, survives a page that reloads after Apply, and asks the model once to name the controls when the rules find none (code still checks every control); larger snapshots for coupon runs | T039 | unit: totals in 9 formats, box/toggle/remove finders, store replies, 8 fake-checkout behaviors, locator view and parsing, WooCommerce and BigCommerce carts; e2e: WooCommerce cart, hidden promo box with slow euro totals, errors and remove buttons | `npm test`; `npx playwright test checkout cart coupons` | done in code; Simulator: nutribullet.com (WooCommerce) BLADESCUPS30 from the store banner, $121.98 to $109.38; tackform.com (Shopify) STREETDEALX $110.00 to $99.00 (mock search); skullcandy.com (Shopify) ran, no guess worked. Page path on a live non-platform store and BigCommerce live not yet checked (blocker 29) |
| T041 | Spec Part 3 §8: Scout mode in the background worker (`src/agent/task.ts`, `src/server/task-host.ts`): the server (the model through the user's provider) proposes a batch of up to 5 actions; the client checks each on the device (allow-list of 11 actions in `src/actions/vocabulary.ts`, site blocklist, Take control, sensitive-action confirmation), performs it through the content script (`src/actions/task-dom.ts`, DOM events: spec 11 fallback), waits 300 ms to settle, and returns results, page structure, and a screenshot where the site allows one; refs preferred, coordinates scaled from screenshot pixels; one task per tab, survives the panel closing, outcome saved to the conversation; `run_task` from chat asks first and continues the answer | T036, T037 | unit: vocabulary, executor, runner (batches, rejection, confirmation even when pre-approved, Take control within 250 ms, Stop, marker before click, blocked site, CAPTCHA, budgets), host (gate, events, prompts, control from the overlay's own tab only); e2e: task with log and summary, unknown action rejected and in Activity, confirmation with pre-approval note, Allow once / Always allow / Revoke, Take control / Resume / Stop, run_task mid-answer, Private Browsing refusal | `npm test`; `npx playwright test scout` | done in code (Chromium run of the e2e locally; WebKit run and Simulator check pending, blocker 30) |
| T042 | Spec Part 3 §8.4, §8.5: client-enforced confirmation card "Scout for Safari wants to: … on site" with Allow once / Always allow on this site / Deny (Deny focused, Escape = Deny), shown even when the server marks the action approved; action log in the panel in plain language, kept under the outcome; Take control / Resume and Stop in the panel and in the overlay pill; toolbar icon switches to the filled-lens variant on the tab while a task runs | T041 | unit + e2e as T041 | `npx playwright test scout overlay` | done in code |
| T043 | Spec Part 3 §9: scouting overlay content script (`src/overlay.ts`, `overlay.js`): full-screen layer with pointer-events none except the pill; conic-gradient wash over the whole page in Safari blues (owner changed this from the spec's thin gold → amber → green border on 2026-10-17), strongest at the edges and lighter in the middle, animated through a registered `--scout-angle` (CSS.registerProperty: @property is ignored in shadow trees), 2.5 s sweep, 600 ms in / 400 ms out, soft blur, half-resolution glow scaled 2x; ripple at the click point 150 ms before each click; pill with binoculars, "Scouting…", Take control, Stop (trusted events only; controls only its own tab's task); static under prefers-reduced-motion; sweep paused while the tab is hidden; open shadow root in the top layer | T041 | e2e: clicks pass through, pill clickable, synthetic clicks ignored, marker before click, hide within 500 ms, sweep 2.5 s and paused when hidden, reduced motion static, real page actions | `npx playwright test overlay` | done in code; Safari 16.0–16.3 (no @property) shows a static border |
| T044 | Spec Part 3 §10: full Permissions screen in Settings: read current page (on), search history and tabs (off), screenshots (ask per site), Scout mode (on, the default: a task starts as soon as it is sent, with no per-task question in any path, by owner decision 2026-10-17 instead of the spec's ask per task; off also hides `run_task`), sensitive-action confirmation (always on, no switch), "Always allow" sites with Revoke, user blocklist, organization blocklist, Private Browsing (disabled), what each conversation shared with Clear / Clear all (`clearShared`) | T037, T041 | unit: gate parsing, always-allow per site and kind, revoke, shared summary and clear; e2e: every control with its default, Scout mode off refuses tasks, shared records viewed and cleared | `npm test`; `npx playwright test scout` | done in code |

## Safeguard coverage (initial applicability)

| # | Safeguard | Initial call | Task |
| --- | --- | --- | --- |
| 1 | Privacy policy | applicable | T016 |
| 2 | Terms | applicable | T016 |
| 3 | Refund policy | NEEDS REVIEW: pricing UNKNOWN; App Store refunds are Apple's | blocker 1 |
| 4 | Cookie policy | applicable as storage disclosure (no cookies; storage.local + Keychain) | T016 |
| 5 | Consent banner | expected NOT APPLICABLE: no tracking; confirm at T017 | T017 |
| 6 | Form consents | applicable: first-run disclosure that page content goes to chosen provider | T006/T007 |
| 7 | No unnecessary data | applicable: redaction, activeTab, retention | T008, T015 |
| 8 | SDK audit | applicable: npm deps, no analytics | T017 |
| 9 | Dark patterns | applicable: our UI + agent must not accept pre-checked upsells | T011, T017 |
| 10 | Hidden fees | applicable: provider API cost disclosure | T014 |
| 11 | Fake reviews | applicable to listing/landing (Phase 6) | T017 |
| 12 | Unsupported claims | applicable: no "best price guaranteed" | T013, T017 |
| 13 | Alt text / labels | applicable | T006, T007, T017 |
| 14 | Contrast | applicable | T001, T017 |
| 15 | Keyboard | applicable (macOS keyboard; iOS VoiceOver/Full Keyboard Access) | T007, T017 |
| 16 | Business details | applicable; UNKNOWN | blocker 1 |
| 17 | Children's data | NEEDS decision: min age; provider terms | blocker 5 |
| 18 | Email unsubscribe | expected NOT APPLICABLE: app sends no email | T017 |
| 19 | Licenses | applicable: original icons; npm license scan; no SafarAI code | T017 |
| 20 | Data deletion | applicable (local): Delete all data; provider-side explained | T015 |

## Execution limits

Ralph: 10 iterations per approved run, 5 `/goal` turns each, stop after two
iterations without progress. Not completion at limit.

## Human review and launch blockers

See `docs/launch-blockers.md`. Gate A (engineering) is not Gate B (release).
