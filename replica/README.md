# Replica artifacts

Outputs: recon map, architecture, design tokens, feature matrix, parity diff,
brand sweep, listing lint.

## Intentional differences

Each place the reference conflicted with accessibility, privacy, honest
pricing, or a safeguard. A removed harmful pattern is not a parity defect.

| Screen / flow | Reference behavior | Our behavior | Reason |
| --- | --- | --- | --- |
| Checkout | Comet can buy a product to criteria | Agent stops before the final order button; user places the order | Avoid unintended purchases; user stays in control |
| Login | Comet can log in with approval | Agent hands control to the user for any login | Never handle passwords |
| Coupon runs | (n/a, new) | Shows every tried code and its real result; no "guaranteed savings" claim | Safeguard 12 |
| Permissions | SafarAI: `<all_urls>` content script | `activeTab` + optional per-site access | Safeguard 7 |
| Bot checks | — | Agent stops at CAPTCHA and asks the user | Never bypass bot detection |
| Assistant panel (Comet reference, 2026-10-16) | Docked side panel inside the browser window; dropdown mode menu with many skills; Comet's own icons and branding | Toolbar popover (Safari has no side-panel API); two-way Chat / Control Browser switch; original line icons and the ant mascot; status line shows cost after every run | Safari platform limit; fewer choices for a two-mode product; no third-party assets; cost transparency (safeguard 10) |
| Coupon finder (Comet run on getbeefy.co, owner reference 2026-10-16) | Searched many sources, tested ~35 codes (mostly guesses) via the store's Shopify cart endpoint in the user's session, applied the best, reloaded the cart | Same approach: deep web search plus labeled pattern guesses, Shopify cart endpoint (page coupon box elsewhere), applies the best and reloads; asks before each further batch of 25; 250 ms pause; stops on 429/CAPTCHA | Owner decision; batch prompt and pause added for user control and politeness to the store |
