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
