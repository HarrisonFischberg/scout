# Compliance checklist — 20 safeguards

Statuses: PASS / FAIL / BLOCKED / NEEDS REVIEW / NOT APPLICABLE.
PASS = engineering checks passed, not legal approval. NOT APPLICABLE needs a
documented reason from actual app behavior. Missing tools or credentials are
BLOCKED, never PASS.

Item text: `~/.claude/skills/new-app/references/safeguards.md`.

| # | Safeguard | Status | Applicability / rationale | Remediation | Files / routes | Tests or checks | Evidence | Owner / open items |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Privacy policy | | | | | | | |
| 2 | Terms of service | | | | | | | |
| 3 | Refund policy | | | | | | | |
| 4 | Cookie policy | | | | | | | |
| 5 | Cookie consent banner | | | | | | | |
| 6 | Form consents | | | | | | | |
| 7 | No unnecessary data | | | | | | | |
| 8 | Third-party SDK audit | | | | | | | |
| 9 | No dark patterns | | | | | | | |
| 10 | No hidden fees | | | | | | | |
| 11 | No fake reviews | | | | | | | |
| 12 | No unsupported claims | | | | | | | |
| 13 | Alt text | | | | | | | |
| 14 | Color contrast (WCAG 2.2 AA) | | | | | | | |
| 15 | Keyboard navigation | | | | | | | |
| 16 | Business details | | | | | | | |
| 17 | Children's data | | | | | | | |
| 18 | Email unsubscribe | | | | | | | |
| 19 | Asset and code licenses | | | | | | | |
| 20 | Data deletion request | | | | | | | |

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
