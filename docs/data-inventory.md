# Data inventory

Planned flows (no backend; nothing reaches an Safari Scout server). Verify each
row against runtime behavior before any safeguard PASS.

| Data collected | Purpose | Collection point | Recipient / storage | Retention | Deletion mechanism |
| --- | --- | --- | --- | --- | --- |
| Provider API key | call the user's chosen AI provider | S03 key field | macOS/iOS Keychain (app group); never in `storage.local`, logs, or prompts | until user removes | S08 Remove key / Delete all data |
| Provider, model, and effort choice | route requests | S03 / S08 | `browser.storage.local` | until changed | Delete all data |
| Permission to share with each AI provider (provider, time allowed, disclosure version; no content) | App Store Review Guideline 5.1.2(i): nothing goes to a provider before the user allows it (2026-10-16) | consent dialog (Allow) before the first request to that provider: chat, Summarize, Control Browser, Find coupons, key test, live model list; iOS host app: consent sheet before Test key | `browser.storage.local` key `aiConsent`; iOS host app `UserDefaults` keys `aiConsent.anthropic` / `aiConsent.openai` (version number only; separate from the extension, which asks again) | until withdrawn, or `CONSENT_VERSION` changes | Settings > Sharing with AI providers > Withdraw, Delete all data; iOS setup screen Withdraw permission; deleting the app |
| Model list (model ids, display names, supported effort levels; no key, no usage) | fill the Settings model and effort dropdowns (2026-10-16) | read-only `GET /v1/models` to the chosen provider with the user's key in a header, when Settings opens and the cached list is over a day old, or on Refresh model list; only after the user allowed sharing with that provider (else the built-in list) | `browser.storage.local` key `modelCache` | replaced after a day | Delete all data |
| Per-tab panel state (tab id, conversation id, panel open flag, timestamp; no page content) | reopen each tab's own conversation (spec Part 1, 2026-10-16) | popup on open, New chat; background worker on panel open/close | `browser.storage.local` key `tabState`; chat entries carry the conversation id | until the tab closes, or Safari restarts | tab close, Safari restart, Delete all data |
| Page content snapshot (text, structure; password and card fields redacted) | answer questions, plan agent actions | content script on user request only | sent to Anthropic or OpenAI (user's own account) | provider's retention under user's account terms | provider-side: user's provider account; local: not stored beyond conversation |
| Screenshots of visible tab (if used by agent) | visual grounding | agent step, user-started run | sent to chosen provider | same as above | same as above |
| Chat messages (question + answer text, T015; agent run logs and coupon runs are NOT saved) | keep a retention-limited history | S04 after a successful answer | `browser.storage.local` key `history` | user setting: off / 7 days / 30 days (default 7); expired entries pruned on popup open; max 200 entries | auto-expiry + S08 Delete all data |
| Granted site origins (per-site access, T015) | read pages the user chose | browser permission prompt | Safari permission store (not Safari Scout storage); listed in S08 | until removed | S08 Remove / Delete all data |
| Coupon codes + cart totals | compare savings | F06 | local run log; codes sent to provider | as run log | as run log |
| Coupon test requests (Shopify stores) | test each code against the real cart | coupon finder, after the user taps Find coupons (cart or checkout page) | the store's own `/cart.js` and `/cart/update.js`, same origin, in the user's browser session (the same request the cart's Apply button sends); nothing goes to Safari Scout | none kept by Safari Scout; the store keeps its own cart | the finder restores the cart's original code if nothing wins |
| Guessed coupon codes | widen the search | built locally from the store's domain name (e.g. BEEFY15, WELCOME10) | used only in the requests above; listed in the results table and history | as chat history | Clear chat history, Delete all data |
| Web search queries for coupons | find codes | F06; again each time the user taps "Find 25 more" after a batch with no saving (2026-10-16); that request also lists up to 150 codes already tried (public codes and guesses, no cart or personal data) so the search skips them | provider web-search tool (Anthropic / OpenAI) | provider terms | provider account |
| Diagnostics (debug builds only): run kind, stage names, user-visible error messages, outcome, token counts, page hostname, provider/model; typed question only if the user opts in | let the developer reproduce bugs the user reports | popup and agent loop while the user uses the app | `browser.storage.local` on the device; copied to the clipboard only when the user taps "Copy diagnostics"; never sent anywhere by the app | last 5 runs | "Clear diagnostics", Delete all data; not present in release builds (`npm run check:release`) |
| Optional autofill profile (should, opt-in) | fill forms on approval | S08 | Keychain | until removed | Delete all data |

Provider calls (T005, `src/providers/`): requests go directly from the
extension to `api.anthropic.com/v1/messages` or `api.openai.com/v1/responses`
with the user's key in a header only (never in the body). Every popup request
to a provider API goes through `gatedFetch` (`src/settings/consent.ts`), which
refuses it unless the user allowed sharing with that provider (2026-10-16). Error messages shown
to the user never include provider response bodies. No new recipient beyond the
vendors above.

Not collected: analytics, crash telemetry, advertising IDs, cookies set by
Safari Scout. Any addition needs a new row and owner approval first.

Vendors (user-selected, BYOK): Anthropic (Messages API), OpenAI (Responses
API). Apple (App Store distribution) once released.

Key test (T006, `apple/App/ProviderSetup.swift`): the host app sends one
read-only GET to `api.anthropic.com/v1/models` or `api.openai.com/v1/models`
with the user's key in a header, when the user presses "Test key", and only
after the user chose Allow on the consent sheet for that provider. Nothing is
logged or stored from the response; only the status code is used. The key is
then written to Keychain on "Save key". No new recipient beyond the vendors
above. The app sandbox gained `com.apple.security.network.client` for this.
