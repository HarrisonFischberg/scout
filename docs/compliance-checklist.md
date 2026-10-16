# Compliance checklist — 20 safeguards

Statuses: PASS / FAIL / BLOCKED / NEEDS REVIEW / NOT APPLICABLE.
PASS = engineering checks passed, not legal approval. NOT APPLICABLE needs a
documented reason from actual app behavior. Missing tools or credentials are
BLOCKED, never PASS.

Item text: `~/.claude/skills/new-app/references/safeguards.md`.

| # | Safeguard | Status | Applicability / rationale | Remediation | Files / routes | Tests or checks | Evidence | Owner / open items |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Privacy policy | NEEDS REVIEW | Applicable. Draft covers all 9 data-inventory rows. | Owner/counsel supply UNKNOWN facts, legal review (blockers 1, 8). Link from app entry points: in-app S09 not built. | `docs/legal/privacy-policy.md` | T016 grep: 9/9 inventory rows, 10 UNKNOWN markers | activity.md T016 | owner + counsel |
| 2 | Terms of service | NEEDS REVIEW | Applicable. Draft discloses coupon limits and agent approval rules; no accounts or billing in app. | Legal review (blockers 1, 4, 5, 8). Assent capture not built (no account flow). | `docs/legal/terms.md` | T016 grep: 11 UNKNOWN markers | activity.md T016 | owner + counsel |
| 3 | Refund policy | NEEDS REVIEW | Pricing UNKNOWN. App has no payment flow; provider bills user directly, App Store refunds are Apple's. | Owner decides price and refund wording (blocker 1). Nothing to test while no payment flow exists. | none | none possible | launch-blockers 1 | owner |
| 4 | Cookie policy | PASS | Applicable as storage disclosure. No cookies, pixels, or SDK identifiers. `storage.local` holds settings/history/granted origins; Keychain holds keys. | Policy sections 2-3 state this. Wording still needs legal review (blocker 8). | `src/popup.ts`, `src/settings/settings.ts`, `docs/data-inventory.md` | grep of `src/` for cookie/localStorage/analytics/telemetry/sendBeacon = no matches 2026-10-15 | activity.md T017 | none beyond blocker 8 |
| 5 | Cookie consent banner | NOT APPLICABLE | No tracking, analytics, ads, or optional cookies exist, so there is nothing to consent to or block. Provider calls are user-initiated and disclosed in the popup. | Re-check if any analytics or SDK is added. | `src/manifest.json` | grep of `src/` for analytics/telemetry/cookie = no matches; `package.json` has devDependencies only | activity.md T017 | none |
| 6 | Form consents | NEEDS REVIEW | Applicable. Popup states page text is sent to the chosen provider; no optional marketing consent, nothing pre-checked (no checkbox in `popup.html`). | First-run disclosure exists in popup (line 141) but a distinct acknowledgement step is not built. Owner decides if one is needed for target markets. | `src/popup.html` | grep checkbox/checked in popup.html = no matches | activity.md T017 | owner (markets, blocker 5) |
| 7 | No unnecessary data | PASS | Permissions justified in PRD: `tabs` for @tab titles/URLs, `activeTab`, per-site optional host access, no `<all_urls>` up front. Password/card/CVV fields redacted. Retention default 7 days, off allowed. | Re-audit if permissions grow. | `src/manifest.json`, `src/snapshot/snapshot.ts`, `src/settings/settings.ts` | `npm test`: 107 passed incl. snapshot redaction (6) and settings retention (11) | activity.md T008, T015, T017 | none |
| 8 | Third-party SDK audit | PASS | Only 4 devDependencies, none shipped as runtime code. No analytics or embedded services. Network hosts: `api.anthropic.com`, `api.openai.com` only. | Re-run audit before release; versions change. | `package.json`, `docs/asset-licenses.md` | `npm audit`: found 0 vulnerabilities (2026-10-15; run printed system-certificate trust warnings, summary line was clean). `fetch` appears only in the two provider adapters and popup injection. | activity.md T017 | none |
| 9 | No dark patterns | NEEDS REVIEW | Applicable. Design has no upsell, urgency, or pre-checked options. Delete-all confirm focuses Cancel. Approval sheet blocks sensitive actions until approved (e2e safety passed supervised). | Human review of rendered onboarding and approval copy; host-app screens S01-S03 not screenshot-reviewed (blocker 14). | `src/popup.html`, `src/safety/classifier.ts` | `npm run e2e -- safety` pass (supervised 2026-10-15, per prd.md T011) | prd.md T011, activity.md T015 | owner (supervised review) |
| 10 | No hidden fees | PASS | No AssistAnt fees. Popup shows tokens and estimated cost; unknown model prices are withheld, not guessed. Provider bills the user separately. | OpenAI price unsourced (blocker 16); Anthropic row re-check before release. | `src/cost.ts`, `docs/claims-evidence.md` | `npm test -- cost`: 4 passed | activity.md T014 | owner (blocker 16) |
| 11 | No fake reviews | PASS | No reviews, ratings, testimonials, or user counts exist in the app or docs. Landing page and listing not yet written (Phase 6). | Re-check when landing page and listing exist. | repo-wide | grep for testimonial/rating terms in `src/` and `docs/legal/` | activity.md T017 | Phase 6 |
| 12 | No unsupported claims | NEEDS REVIEW | Applicable. `docs/claims-evidence.md` has 2 rows. Coupon UI now says codes come from provider web search with a source link (T019, mocked only; live check pending, blocker 15). No savings or best-price promise in drafts. | Add rows for every listing/landing claim at Phase 6. Do not claim web search works until the live check passes. | `docs/claims-evidence.md`, `src/popup.html` | manual read of drafts and popup copy | launch-blockers 15, 16 | owner + build |
| 13 | Alt text | NEEDS REVIEW | Popup has no `<img>`; controls use text labels; log, status, dialogs have names (aria-label / aria-labelledby). Host-app SwiftUI labels written in T006 but not checked with VoiceOver. | Run VoiceOver/Accessibility Inspector on S01-S03 and popup in Safari (supervised, blocker 14). web-quality-audit not runnable here (no browser). | `src/popup.html`, `apple/App/` | grep `<img` in popup.html = no matches; role/aria-label on lines 103-164 | activity.md T017 | supervised session |
| 14 | Color contrast (WCAG 2.2 AA) | NEEDS REVIEW | Tokens pass: 34 pairs, 0 failing AA, light and dark. Rendered UI contrast not tested (WebKit blocked here, blocker 12). | Supervised: rendered check in Safari light and dark incl. error/hover/selected states. | `replica/design/tokens.json`, `src/popup.html` | `replica/contrast.txt`: 34 pairs, 0 failing AA | replica/contrast.txt | supervised session |
| 15 | Keyboard navigation | NEEDS REVIEW | Popup has visible focus ring (`:focus-visible`, 2px), dialog roles, focus to Cancel on delete confirm. Keyboard-only chat e2e passed supervised (T007). iOS Full Keyboard Access and macOS host app not checked. | Manual keyboard pass in Safari; iOS Full Keyboard Access (T018). | `src/popup.html`, `tests/e2e/chat.spec.ts` | `npm run e2e -- chat` pass (supervised 2026-10-15, per prd.md T007) | prd.md T007 | supervised session |
| 16 | Business details | BLOCKED | Entity, location, contact are UNKNOWN. Nothing invented or published. | Owner supplies verified details (blocker 1). Required before listing and legal pages. | `docs/launch-blockers.md` | n/a | launch-blockers 1 | owner |
| 17 | Children's data | BLOCKED | Minimum age and provider age rules UNKNOWN. App collects no birth date or identity document. Page content may include a child's data if a child uses the browser. | Owner and counsel decide audience and minimum age (blocker 5); terms must state it. | `docs/legal/terms.md` | n/a | launch-blockers 5 | owner + counsel |
| 18 | Email unsubscribe | NOT APPLICABLE | App sends no email and has no accounts, mailing list, or email field. | Re-check if any email feature is added. | `src/`, `docs/` | grep -i unsubscribe/newsletter/mailto in `src` and `docs`: only this checklist matches | activity.md T017 | none |
| 19 | Asset and code licenses | NEEDS REVIEW | No fonts, images, or icon files shipped; system font stack. 5 packages listed with licenses. No SafarAI code (PRD rule). Safari extension icons not yet created. | Run a license scan on the full npm tree and record icon licenses when icons exist. | `docs/asset-licenses.md`, `package.json` | manual read of `docs/asset-licenses.md`; full-tree license scan not run | activity.md T017 | build |
| 20 | Data deletion request | NEEDS REVIEW | Local deletion built: Delete all data removes both Keychain items, `storage.local`, and granted origins; failures named. Provider-side records explained as provider-held. Unit tests pass; e2e settings never run in a browser here. | Supervised: `npm run e2e -- settings`, XCTest Keychain delete. Host-app deletion screen not built. | `src/settings/settings.ts`, `src/popup.ts` | `npm test -- settings`: 11 passed | activity.md T015 | supervised session |

## T016 legal draft review checklist

Drafts: `docs/legal/privacy-policy.md`, `docs/legal/terms.md` (both marked
DRAFT, not legal advice, need qualified review, blocker 8).

| Data-inventory row | In privacy policy section 3 |
| --- | --- |
| Provider API key | yes |
| Provider + model choice | yes |
| Page content snapshot | yes |
| Screenshots | yes |
| Chat messages (history) | yes |
| Granted site origins | yes |
| Coupon codes + cart totals | yes |
| Web search queries | yes |
| Autofill profile (not built) | yes, marked not yet built |

- Not collected (analytics, telemetry, ad IDs, cookies): section 2.
- Vendors Anthropic, OpenAI, Apple: section 4.
- Deletion and retention: sections 3 and 6.
- Every unknown fact is marked UNKNOWN, none invented: entity, location,
  contact, effective date, minimum age, price, refunds, governing law,
  regional regimes, warranty/liability wording (blockers 1, 4, 5).
- Not done here: safeguard rows 1-4 status (T017); in-app S09 screen.
