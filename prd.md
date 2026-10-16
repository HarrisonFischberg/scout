# assist-ant — PRD

Status: APPROVED by owner 2026-10-15 (chat). Build with mocked AI providers until test keys are supplied.

## Purpose

AssistAnt: a Safari toolbar AI assistant and supervised browser agent for
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
6. Privacy: no AssistAnt server, no analytics; history retention setting;
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
- Native messaging (`SafariWebExtensionHandler`) for Keychain read/write.
  The key never enters `storage.local`, logs, or model prompts.
- Permissions: `activeTab`, `storage`, `scripting`, `nativeMessaging`,
  `contextMenus`; host access requested per site, not `<all_urls>` up front.
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
| T002a | Xcode multiplatform Safari extension project; esbuild TS pipeline; Safari API support table from MDN compat data | — | Both targets build; `npm run build` emits extension into `apple/Extension/Resources`; `docs/safari-api-support.md` exists | `npm run build`; `xcodebuild -project apple/AssistAnt.xcodeproj -scheme "AssistAnt (macOS)" -derivedDataPath build/DD CODE_SIGNING_ALLOWED=NO build`; same for `"AssistAnt (iOS)" -destination 'generic/platform=iOS Simulator'` (supervised) | done (supervised 2026-10-15: both BUILD SUCCEEDED, see activity.md) |
| T002b | Load the extension in Safari macOS and the iOS Simulator; runtime-verify the API support table | T002a | Extension appears and its popup opens in both; table's Runtime-verified column filled | owner manual check + screenshots in `ralph/evidence/` | owner — macOS PASS (owner-reported 2026-10-15: enabled in Safari Settings → Extensions, toolbar popup opened); iOS Simulator load + runtime API column pending |
| T003 | Test harness: Vitest, Playwright WebKit, local fixture site (shop, forms, injection page), lint, typecheck | T002a | `npm test`, `npm run e2e`, `npm run lint`, `npm run typecheck` all run green on a trivial test | those commands | needs supervised check (typecheck, lint, test green; `npm run e2e` WebKit launch blocked by sandbox, see activity.md) |
| T004 | Keychain bridge via native messaging (set/get/delete key) | T002a | XCTest covers set/get/delete; JS never persists key; grep finds no key in storage | `xcodebuild test`; `npm test -- keychain` | pending |
| T005 | Provider layer: Anthropic + OpenAI adapters, streaming, tool calls, error mapping (401, 429, network), token usage | T003 | Unit tests with recorded fixtures pass for both providers; errors map to user messages | `npm test -- providers` | pending |
| T006 | Host app onboarding + key setup screens (S01–S03), VoiceOver labels | T001, T004 | Screens render light/dark; Test key button shows valid/invalid; Accessibility Inspector no errors | `xcodebuild test` + screenshots in `ralph/evidence/` | pending |
| T007 | Popup chat (S04): page Q&A, summarize, streaming, no-key + error states, keyboard operable | T001, T005 | Playwright: ask + summarize on fixture page with mocked provider; keyboard-only path passes | `npm run e2e -- chat` | pending |
| T008 | Page snapshot builder: text + interactive elements with stable refs; redact password/card/CVV fields | T003 | Unit tests: redaction verified; snapshot under size budget on large fixture | `npm test -- snapshot` | pending |
| T009 | Action executor: click/type/select/scroll/navigate/wait by ref; result reporting | T008 | Playwright on fixtures: each action succeeds; missing ref fails cleanly | `npm run e2e -- actions` | pending |
| T010 | Agent loop: plan, step list UI (S05), budgets, Pause/Stop | T005, T007, T009 | E2E with scripted mock model completes a 5-step form task; Stop halts within one step | `npm run e2e -- agent` | pending |
| T011 | Safety layer: sensitive-action classifier + approval sheet (S06), CAPTCHA stop, untrusted-content wrapping | T010 | E2E: order-submit, login, and send are blocked until approved; injection fixture cannot trigger an unapproved action | `npm run e2e -- safety` | pending |
| T012 | @tab multi-tab context | T007 | E2E: answer cites content from 2 selected fixture tabs | `npm run e2e -- tabs` | pending |
| T013 | Coupon finder (F06): search codes, try 1×1, parse totals, keep best, never click order (S07) | T010, T011 | E2E on fixture shop with 5 codes (2 valid, different %): best one applied, all attempts listed with real totals, order button never clicked | `npm run e2e -- coupons` | pending |
| T014 | Cost display: tokens + estimated cost per run, price table dated and sourced | T005 | Unit test on cost math; price source recorded in `docs/claims-evidence.md` | `npm test -- cost` | pending |
| T015 | Settings (S08): provider/model, retention, per-site access, Delete all data | T004, T007 | E2E: Delete all data clears storage and Keychain item; retention expiry unit-tested | `npm run e2e -- settings`; `xcodebuild test` | pending |
| T016 | Draft privacy policy + terms (S09) from data inventory; marked DRAFT for legal review | T015 | Every data-inventory row reflected; UNKNOWN facts marked, not invented | manual review checklist in `docs/compliance-checklist.md` | pending |
| T017 | Safeguards sweep: fill all 20 rows; a11y audits (web-quality-audit on popup pages, Accessibility Inspector on SwiftUI) | T006–T016 | Each row has status + evidence path; no PASS without evidence | `docs/compliance-checklist.md` review | pending |
| T018 | iOS Simulator + Safari macOS manual verification of F01–F07 with screenshots | T017 | Screenshot per flow in `ralph/evidence/`; failures logged as bugs | manual + `xcrun simctl io booted screenshot` | pending |

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
