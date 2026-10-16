# Data inventory

Planned flows (no backend; nothing reaches an AssistAnt server). Verify each
row against runtime behavior before any safeguard PASS.

| Data collected | Purpose | Collection point | Recipient / storage | Retention | Deletion mechanism |
| --- | --- | --- | --- | --- | --- |
| Provider API key | call the user's chosen AI provider | S03 key field | macOS/iOS Keychain (app group); never in `storage.local`, logs, or prompts | until user removes | S08 Remove key / Delete all data |
| Provider + model choice | route requests | S03 / S08 | `browser.storage.local` | until changed | Delete all data |
| Page content snapshot (text, structure; password and card fields redacted) | answer questions, plan agent actions | content script on user request only | sent to Anthropic or OpenAI (user's own account) | provider's retention under user's account terms | provider-side: user's provider account; local: not stored beyond conversation |
| Screenshots of visible tab (if used by agent) | visual grounding | agent step, user-started run | sent to chosen provider | same as above | same as above |
| Chat messages (question + answer text, T015; agent run logs and coupon runs are NOT saved) | keep a retention-limited history | S04 after a successful answer | `browser.storage.local` key `history` | user setting: off / 7 days / 30 days (default 7); expired entries pruned on popup open; max 200 entries | auto-expiry + S08 Delete all data |
| Granted site origins (per-site access, T015) | read pages the user chose | browser permission prompt | Safari permission store (not AssistAnt storage); listed in S08 | until removed | S08 Remove / Delete all data |
| Coupon codes + cart totals | compare savings | F06 | local run log; codes sent to provider | as run log | as run log |
| Web search queries for coupons | find codes | F06 | provider web-search tool (Anthropic / OpenAI) | provider terms | provider account |
| Diagnostics (debug builds only): run kind, stage names, user-visible error messages, outcome, token counts, page hostname, provider/model; typed question only if the user opts in | let the developer reproduce bugs the user reports | popup and agent loop while the user uses the app | `browser.storage.local` on the device; copied to the clipboard only when the user taps "Copy diagnostics"; never sent anywhere by the app | last 5 runs | "Clear diagnostics", Delete all data; not present in release builds (`npm run check:release`) |
| Optional autofill profile (should, opt-in) | fill forms on approval | S08 | Keychain | until removed | Delete all data |

Provider calls (T005, `src/providers/`): requests go directly from the
extension to `api.anthropic.com/v1/messages` or `api.openai.com/v1/responses`
with the user's key in a header only (never in the body). Error messages shown
to the user never include provider response bodies. No new recipient beyond the
vendors above.

Not collected: analytics, crash telemetry, advertising IDs, cookies set by
AssistAnt. Any addition needs a new row and owner approval first.

Vendors (user-selected, BYOK): Anthropic (Messages API), OpenAI (Responses
API). Apple (App Store distribution) once released.

Key test (T006, `apple/App/ProviderSetup.swift`): the host app sends one
read-only GET to `api.anthropic.com/v1/models` or `api.openai.com/v1/models`
with the user's key in a header, when the user presses "Test key". Nothing is
logged or stored from the response; only the status code is used. The key is
then written to Keychain on "Save key". No new recipient beyond the vendors
above. The app sandbox gained `com.apple.security.network.client` for this.
