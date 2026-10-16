# Safari Scout — final status report

Date: 2026-10-15. Repository: https://github.com/HarrisonFischberg/safari-scout (private; renamed to Safari Scout on 2026-10-16).

This is an engineering launch-readiness report. It is not legal advice and
does not state that the app is legally compliant. PASS below means the stated
engineering checks passed, not legal approval.

## 1. What was built

Safari Scout is a Safari Web Extension for macOS and iOS with a SwiftUI host app.
The user brings their own Anthropic or OpenAI API key. There is no Safari Scout
server and no analytics.

- Host app: setup screen, provider + key test and save (Keychain, shared with
  the extension on iOS through a Keychain access group), draft legal pages.
- Toolbar popup: ask about the page, summarize, ask across tabs (@tab),
  streamed answers, token count and estimated cost after every run.
- Agent: page snapshot, click/type/select/scroll/navigate/wait, plan and step
  list, Pause and Stop, approval sheet before sensitive actions, CAPTCHA stop,
  page text treated as untrusted, 15-second page-call timeout.
- Coupon finder: only tries codes that the provider's web search returned
  with a source URL, tries them one at a time, keeps the best, never clicks
  the order button.
- Settings: provider, model, history retention, per-site access, Delete all
  data, links to the DRAFT privacy policy and terms.

Tasks: 18 of 21 done. T002b (owner check), T006 and T018 are partly blocked
(see section 7).

## 2. Tools used

| Tool | Status | Version / note |
| --- | --- | --- |
| Replica | used | replica-skill 1.0.0 (recon map, feature matrix, contrast tool) |
| REA | partial | MCP server answered; no CDP browser target, so no page capture (blocker 7) |
| `/goal` | used | Claude Code 2.1.299; verified headless |
| Ralph loop | used | original `ralph/ralph.sh` modeled on coleam00/ralph-loop-quickstart (repo has no license); 4 runs, Sonnet 5.5, $5 cap per iteration |
| Caveman | used | 3.2.0 |
| ui-ux-pro-max, fixing-accessibility | used | vendored, MIT |
| web-quality-audit | partial | Lighthouse and Chrome DevTools MCP not available; axe-core 4.14.0 in Playwright WebKit used instead |
| Xcode | used | 27.0; iOS 27 Simulator |

## 3. REA findings and how they were used

- SafarAI (public, no license): studied README and manifest only. Its shape
  (Xcode app + MV3 extension) was reused as an idea; no code or assets were
  copied. Its `<all_urls>` content script was replaced with `activeTab` plus
  per-site access.
- Comet (public page + owner summary): Pause/Stop, approval before sensitive
  actions, and @tab context informed the agent and chat design.
- Intentional differences are listed in `replica/README.md`: no autonomous
  purchase, no automated login, no CAPTCHA solving, no `<all_urls>` access.

## 4. Safeguards

| # | Safeguard | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Privacy policy | NEEDS REVIEW | `docs/legal/privacy-policy.md` (DRAFT) |
| 2 | Terms of service | NEEDS REVIEW | `docs/legal/terms.md` (DRAFT) |
| 3 | Refund policy | NEEDS REVIEW | pricing UNKNOWN (blocker 1) |
| 4 | Cookie policy | PASS | no cookies set; storage disclosed in privacy draft |
| 5 | Cookie consent banner | NOT APPLICABLE | no tracking or optional cookies |
| 6 | Form consents | NEEDS REVIEW | first-run disclosure; markets UNKNOWN |
| 7 | No unnecessary data | PASS | `activeTab`, per-site access, field redaction tests |
| 8 | Third-party SDK audit | PASS | `npm audit` 0 vulnerabilities; no runtime deps |
| 9 | No dark patterns | PASS | equal-weight approval and delete choices; e2e |
| 10 | No hidden fees | PASS | provider-billing disclosure at key setup; cost after each run |
| 11 | No fake reviews | PASS | none in product; listing not written yet |
| 12 | No unsupported claims | NEEDS REVIEW | coupon codes require a source; listing pending |
| 13 | Alt text / labels | NEEDS REVIEW | axe + iOS audit pass; macOS VoiceOver not checked |
| 14 | Color contrast | NEEDS REVIEW | token, axe and iOS audits pass; macOS app not checked |
| 15 | Keyboard navigation | NEEDS REVIEW | Option+Tab walk passes; macOS host app not checked |
| 16 | Business details | BLOCKED | entity and contact UNKNOWN |
| 17 | Children's data | BLOCKED | minimum age decision open |
| 18 | Email unsubscribe | NOT APPLICABLE | app sends no email |
| 19 | Asset and code licenses | NEEDS REVIEW | licenses recorded; icons are placeholders |
| 20 | Data deletion request | NEEDS REVIEW | works on iOS; Safari site access must be removed by the user |

Totals: 6 PASS, 2 NOT APPLICABLE, 2 BLOCKED, 10 NEEDS REVIEW.

## 5. Verification

| Check | Command | Result |
| --- | --- | --- |
| Unit | `npm test` | 121 passed |
| e2e (WebKit, incl. axe) | `npx playwright test` | 42 passed |
| Types / lint | `npm run typecheck`, `npm run lint` | clean |
| XCTest | `xcodebuild ... -scheme SafariScoutTests test` | 11 passed |
| iOS accessibility audit | `xcodebuild ... -scheme SafariScoutUITests test` | 3 passed (light, dark, legal sheet) |
| Builds | macOS + iOS Simulator | succeeded; both bundles contain all 7 resources |
| Live, iOS Simulator, Anthropic key | F02 ask, F03 summarize, F05 agent with approval, F06 coupons, F07 delete | pass |

Live testing found 8 defects that mocked tests had missed. All 8 are fixed
and covered by new tests:

1. The required browser-access header was missing, so every request got a 401.
2. `content.js` and the legal pages were missing from both extension bundles.
3. The agent could hang forever, and Stop did nothing.
4. Unread tabs were reported only in a status line that "Done" overwrote.
5. Choosing OpenAI silently fell back to Anthropic.
6. The host app showed "saved" for the wrong provider.
7. Opening Settings popped the iOS picker open.
8. Delete all data reported success while Safari site access remained.

Not verified: the OpenAI live path, macOS Safari flows beyond loading the
extension, and the coupon finder against a real merchant.

## 6. Intentional differences from the references

See `replica/README.md`. In short, the user always places the order and logs
in themselves. The agent stops at CAPTCHAs. Access is granted per site.
Every coupon attempt is shown with its real result.

## 7. Open blockers and decisions

Owner decisions and facts: legal entity, business location, launch markets,
contact details, minimum age, pricing and refunds (blocker 1). You also need
an Apple Developer membership and a real bundle ID (blockers 2, 11), and
original icons (blocker 19).

Legal review: the privacy and terms drafts (blocker 8). Merchant terms for
automated coupon trying (blocker 4). AI provider usage policies (blocker 5).
Deletion wording given the iOS site-access limit (blocker 20).

Engineering: OpenAI key and live path, plus verifying the `gpt-5` model and
price (blockers 3, 16). macOS Safari live flows (blocker 18). @tab cannot read
background tabs on iOS (blocker 17). macOS Keychain sharing needs a team ID
(blocker 14).

## 8. Status

- Gate A, engineering work package complete: **not met**. T006 and T018 are
  partly blocked and T002b's runtime API check is open.
- Gate B, ready for release: **not met**. Business facts are missing, legal
  review is pending, and Apple signing is not set up.

## 9. External changes

- Created the private GitHub repo (now `HarrisonFischberg/safari-scout`) and pushed
  commits to `main`. Both were approved.
- Live calls to the Anthropic API used your test key: about $0.04 at list
  price (app estimates: $0.0014 + $0.0018 + $0.0023 + $0.03 + $0.0073). The
  Ralph loop runs were billed to the Claude Code
  account, capped at $5 per iteration.
- Nothing was deployed, no email was sent, no purchase was made, and no
  production data exists.
