# Legal pages: what is left before publishing

Status on 2026-10-16:

- Consent wording (`docs/legal/consent-review.md`): reviewed by counsel,
  no changes requested (reported by the owner, 2026-10-16). Ready.
- Privacy policy (`privacy-policy.md`, 10 UNKNOWN) and terms (`terms.md`,
  11 UNKNOWN): not yet reviewed by counsel. Not ready to publish.

Plan (owner, 2026-10-16): get everything ready now and publish once the
business is registered (EIN and other business details). Nothing is
published until the owner says go.

## A. Facts the owner supplies

The EIN itself is not needed on any public page. Keep it out of the policy,
terms, and listing; it belongs only on tax and account forms.

| Fact | Privacy policy | Terms |
| --- | --- | --- |
| Legal entity name and trading name | line 8 "Operator" | line 7 "Operator" |
| Business location (address) | line 9 | (governing law, line 9) |
| Privacy contact (email) | line 10, §11 Contact (line 95) | §10 Contact (line 76) |
| General contact | | line 10 |
| Effective date | line 7 | line 8 |
| Governing law and venue | | line 9 |
| Launch countries | §9 (line 87) | §8 (line 67) |
| Minimum age | §7 (line 76) | line 23 |
| Price, trials, renewal, refunds (or "free") | | lines 29-30 |
| How users are told about changes | §10 (line 91) | §9 (line 72) |

## B. Text counsel writes or reviews

- Privacy §4: provider processors and sub-processors (line 56).
- Privacy §9: international transfers, legal bases, regional rights.
- Terms §8: warranty disclaimer, limitation of liability, indemnity,
  consumer-rights carve-outs.
- Terms §9: termination and changes.
- Review of both documents once section A is filled in.
- If counsel answered the questions in `consent-review.md` section 6, add
  their answers there so the record is complete.

## C. Engineering steps when A and B are done

1. Fill the placeholders word for word; no UNKNOWN left
   (`grep -c UNKNOWN docs/legal/*.md` is 0).
2. Remove the DRAFT labels: `scripts/build.mjs` (page title and banner),
   `apple/App/OnboardingView.swift` ("(draft)" titles and banner, "Legal
   (DRAFT)"), `src/popup.html` (Legal section).
3. Publish the two pages at a public URL. Needs the owner's go and a host
   (for example GitHub Pages on this repository, or the business website).
4. Enter that URL in App Store Connect (Privacy Policy URL) and answer the
   App Privacy questions from `docs/data-inventory.md`.
5. Update compliance rows 1, 2, 16, 17 and launch-blockers 1, 5, 8.
