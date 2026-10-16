# Claims and evidence

Every material claim (UI, landing page, store listing, metadata, email) needs
a row before launch.

| Claim | Where it appears | Evidence | Verified by | Status |
| --- | --- | --- | --- | --- |
| Estimated cost per run for Claude Sonnet 5.5: $2 / MTok input, $10 / MTok output | Popup status line after chat, agent, coupon runs | https://platform.claude.com/docs/en/about-claude/pricing (Sonnet 5.5 row), fetched 2026-10-15 | `npm test -- cost` | Verified (list price; provider bill governs) |
| Estimated cost for OpenAI models | Not shown: no sourced price recorded | OpenAI pricing page fetch was not permitted in this session | n/a | UNKNOWN: UI shows tokens only and "estimate unavailable" |
| "Guess (common pattern)" / "Guess (hint from …)" labels on coupon results | popup coupon table, chat summary | `src/coupons/candidates.ts` originLabel; unit tests "labels guesses honestly" | unit + e2e | PASS (engineering) |
| "It's applied to your cart, and I didn't go to checkout." | coupon chat summary | applied only after a fresh cart read confirms the total (`runCouponSearch` apply step); order button never clicked (e2e clicks check) | unit + e2e | PASS (engineering) |
