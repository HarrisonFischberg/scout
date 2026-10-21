# Scout AI Assistant Privacy Policy (DRAFT)

> **Superseded (2026-10-21).** The published policy at
> https://rarecreatures.app/apps/scout/privacy/ (last updated 19 October 2026,
> Rare Creatures LLC) is the source of truth: the app, the extension's
> Settings and the App Store listing link to it. Its source lives in the
> website repository (HarrisonFischberg/studio-site), not here. This draft is
> kept unchanged as the record of what was prepared for counsel; it is not
> maintained. No record shows counsel reviewed the published page (launch
> blocker 8), and it is behind the app in places (launch blocker 36).

> DRAFT for qualified legal review. Not approved. Not for publication.
> Items marked **UNKNOWN** are missing facts the owner must supply
> (`docs/launch-blockers.md`, blocker 1). Nothing here is invented.

Effective date: UNKNOWN
Operator (legal entity and trading name): UNKNOWN
Business location: UNKNOWN
Privacy contact: UNKNOWN

## 1. What Scout AI Assistant is

Scout AI Assistant ("Scout", formerly Scout) is a browser extension for
Safari (with a host app for macOS and iOS), Chrome and Firefox. It sends
your questions and page content to an AI provider you choose (Anthropic or
OpenAI), using your own API key. Scout has no server of its own: nothing
you do in Scout is sent to the operator.

## 2. What we do not collect

Scout contains no analytics, no crash telemetry, no advertising
identifiers, and sets no cookies. The operator does not receive your key,
page content, chat messages, or usage data.

## 3. Data Scout handles, and where it goes

| Data | Why | Where it goes or is stored | How long | How to delete |
| --- | --- | --- | --- | --- |
| Provider API key | call your chosen provider | Safari: Keychain on your device, not in extension storage. Chrome and Firefox: the browser's local extension storage on that computer, never synced. Never in logs or prompts | until you remove it | Remove key, or Delete all data |
| Provider and model choice | route requests | extension storage on your device | until changed | Delete all data |
| Your permission to share with each AI provider (provider, date, disclosure version) | send nothing to a provider until you allow it | extension storage on your device; the iPhone and iPad app keeps its own copy for testing your key | until you withdraw it, or the disclosure changes | Withdraw in Settings (or on the app's setup screen), or Delete all data |
| Page content for questions: the current page (you can turn this off in Settings > Page access) and tabs you attach, as text with the page's title, address, and description. Form entries, password fields, hidden fields, and hidden content are left out; passwords, keys, and tokens found on the page are removed | answer questions | sent to the provider you chose, only when you ask. Never from sites you or your organization blocked. Not stored by Scout | provider's retention under your account terms | provider-side: your provider account |
| Page structure for Scout mode and Find coupons (links, buttons, form fields; password and card fields redacted), and in Scout mode a screenshot after each step where you allow screenshots for that site | plan agent actions | sent to the provider you chose, only when you start a task | provider's retention under your account terms | provider-side: your provider account |
| Screenshot of the visible part of the current page. It shows everything on screen, including anything typed into the page | answer when the page text is not enough | sent to the provider you chose, only after you allow it for that site (once or always). Never for blocked sites | provider's retention | provider-side: your provider account |
| Titles and addresses of your open tabs | find tabs when a question needs it | sent to the provider you chose, only if you turn on tab search in Settings (off by default). Private tabs and blocked sites are left out | provider's retention | provider-side: your provider account |
| Page access choices (sharing the current page, tab search, per-site screenshot answers, sites you blocked) | follow your choices | extension storage on your device | until you change them | Settings, or Delete all data |
| Activity log (time, tool, site, how long it took, result; no page text) | a record on your device of the tools Scout used (not shown in Settings since 2026-10-17) | extension storage on your device; only in memory when chat history is off | same as chat history | auto-expiry, or Delete all data |
| Sites your organization blocked | follow your organization's policy | set by your administrator on a managed device; read, not stored, by Scout | while your administrator's profile is installed | your administrator |
| Chat questions and answers, with the list of tabs shared for each answer (title and site, not page text) | optional history | extension storage on your device | your setting: off, 7 days, or 30 days (default 7). Max 200 entries. Chats in a Private Browsing tab are deleted when that tab closes or Safari restarts | auto-expiry, closing the private tab, or Delete all data |
| Sites you granted access to | read pages you chose | the browser's own permission store; listed in Settings | until removed | Remove in Settings, or Delete all data |
| Coupon codes and cart totals | compare savings | local run log. Codes are sent to the provider | as the run log | as the run log |
| Coupon search queries | find codes | the provider's web-search tool | provider terms | provider account |
| Codes a store advertises on its own site (for example "use code X" in a banner) | try the store's own codes | read on your device from the page you are on and the store's home page, only when you tap Find coupons; only the codes are kept | as the run log | as the run log |
| On checkouts Scout cannot read by itself: the page title, the names of its buttons and fields (not what you typed in them), and the lines about totals and codes | find the coupon box | sent to the provider you chose, at most once per coupon search | provider's retention under your account terms | provider-side: your provider account |
| Optional autofill profile (not yet built) | fill forms with your approval | Keychain | until removed | Delete all data |

Agent run logs and coupon runs are not saved to history in the current
version.

## 4. Third parties

Your chosen AI provider receives the data in section 3 under your own
account and its terms: Anthropic (Messages API) or OpenAI (Responses API).
Scout asks for your permission once per provider before it sends
anything to that provider, names the provider and what is sent, and links to
its privacy policy and to the terms for its API. Nothing is sent if you choose
Not now. The providers' privacy policies say they do not cover content sent
through their business offerings such as the API; requests made with your own
API key fall under Anthropic's Commercial Terms or OpenAI's API data
commitments.
Read their privacy policies; Scout cannot control provider handling.
Apple distributes the app through the App Store. Provider processors and
sub-processors: UNKNOWN until reviewed.

## 5. Sensitive data

Pages you view may contain personal, financial, or health information.
Scout redacts password and card fields before sending a page snapshot.
It cannot recognise all sensitive text. Do not use Scout on pages whose
content you do not want sent to your provider.

## 6. Your choices

- Settings: choose provider, model, history retention, per-site access.
- Sharing with AI providers: see which provider you allowed, and withdraw it.
  After you withdraw, nothing is sent to that provider until you allow it again.
- Delete all data: removes both keys (Keychain on Safari), extension storage, and
  granted site access on this device.
- Data held by your provider is deleted through your provider account.

## 7. Children

Minimum age: UNKNOWN. Provider age terms apply: UNKNOWN pending review
(blocker 5).

## 8. Security

On Safari the key is kept in the system Keychain; on Chrome and Firefox, in the
browser's local extension storage. Requests go directly from your
device to the provider. No system is perfectly secure.

## 9. International transfers, legal bases, regional rights

Launch countries and applicable regimes (for example GDPR, UK GDPR, CCPA):
UNKNOWN. Counsel must complete this section.

## 10. Changes

Change process and notice: UNKNOWN.

## 11. Contact

UNKNOWN.
