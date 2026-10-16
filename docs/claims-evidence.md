# Claims and evidence

Every material claim (UI, landing page, store listing, metadata, email) needs
a row before launch.

| Claim | Where it appears | Evidence | Verified by | Status |
| --- | --- | --- | --- | --- |
| "Cost: $X" per run for Claude models, at list prices: Fable 5.1 / 5 and Mythos 5.1 / 5 $10 / $50; Opus 5.5 $4 / $20; Opus 5, 4.8, 4.7, 4.6, 4.5 $5 / $25; Sonnet 5.5 and 5 $2 / $10; Sonnet 4.6 and 4.5 $3 / $15; Haiku 5.5 $0.10 / $0.50 (prompts over 100,000 tokens $0.50 / $2.50); Haiku 4.5 $1 / $5 (input / output per MTok); web search $10 per 1,000 searches | Popup line under the conversation after chat, agent, coupon runs (`src/cost.ts` `PRICES`) | https://platform.claude.com/docs/en/about-claude/pricing ("Model pricing", "Long context pricing", "Web search tool"), fetched 2026-10-16 | `npm test -- cost`; e2e "the conversation is saved…" checks the line | Verified (list price, an estimate; provider bill governs). Excludes prompt-cache and US-only `inference_geo` pricing, which the app does not use |
| Estimated cost for OpenAI models | "Cost: not available for <model>" | OpenAI pricing page fetch was not permitted in this session | n/a | UNKNOWN: no price is guessed |
| "Guess (common pattern)" / "Guess (hint from …)" labels on coupon results | popup coupon table, chat summary | `src/coupons/candidates.ts` originLabel; unit tests "labels guesses honestly" | unit + e2e | PASS (engineering) |
| "It's applied to your cart, and I didn't go to checkout." | coupon chat summary | applied only after a fresh cart read confirms the total (`runCouponSearch` apply step); order button never clicked (e2e clicks check) | unit + e2e | PASS (engineering) |
