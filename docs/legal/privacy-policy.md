# AssistAnt Privacy Policy (DRAFT)

> DRAFT for qualified legal review. Not approved. Not for publication.
> Items marked **UNKNOWN** are missing facts the owner must supply
> (`docs/launch-blockers.md`, blocker 1). Nothing here is invented.

Effective date: UNKNOWN
Operator (legal entity and trading name): UNKNOWN
Business location: UNKNOWN
Privacy contact: UNKNOWN

## 1. What AssistAnt is

AssistAnt is a Safari extension and host app for macOS and iOS. It sends
your questions and page content to an AI provider you choose (Anthropic or
OpenAI), using your own API key. AssistAnt has no server of its own: nothing
you do in AssistAnt is sent to the operator.

## 2. What we do not collect

AssistAnt contains no analytics, no crash telemetry, no advertising
identifiers, and sets no cookies. The operator does not receive your key,
page content, chat messages, or usage data.

## 3. Data AssistAnt handles, and where it goes

| Data | Why | Where it goes or is stored | How long | How to delete |
| --- | --- | --- | --- | --- |
| Provider API key | call your chosen provider | Keychain on your device. Not in extension storage, logs, or prompts | until you remove it | Remove key, or Delete all data |
| Provider and model choice | route requests | extension storage on your device | until changed | Delete all data |
| Page content (text and structure; password and card fields redacted) | answer questions, plan agent actions | sent to the provider you chose, only when you ask. Not stored by AssistAnt beyond the conversation | provider's retention under your account terms | provider-side: your provider account |
| Screenshots of the visible tab, if the agent uses them | visual grounding | sent to the provider you chose | provider's retention | provider-side: your provider account |
| Chat questions and answers | optional history | extension storage on your device | your setting: off, 7 days, or 30 days (default 7). Max 200 entries | auto-expiry, or Delete all data |
| Sites you granted access to | read pages you chose | Safari's permission store; listed in Settings | until removed | Remove in Settings, or Delete all data |
| Coupon codes and cart totals | compare savings | local run log. Codes are sent to the provider | as the run log | as the run log |
| Coupon search queries | find codes | the provider's web-search tool | provider terms | provider account |
| Optional autofill profile (not yet built) | fill forms with your approval | Keychain | until removed | Delete all data |

Agent run logs and coupon runs are not saved to history in the current
version.

## 4. Third parties

Your chosen AI provider receives the data in section 3 under your own
account and its terms: Anthropic (Messages API) or OpenAI (Responses API).
Read their privacy policies; AssistAnt cannot control provider handling.
Apple distributes the app through the App Store. Provider processors and
sub-processors: UNKNOWN until reviewed.

## 5. Sensitive data

Pages you view may contain personal, financial, or health information.
AssistAnt redacts password and card fields before sending a page snapshot.
It cannot recognise all sensitive text. Do not use AssistAnt on pages whose
content you do not want sent to your provider.

## 6. Your choices

- Settings: choose provider, model, history retention, per-site access.
- Delete all data: removes both Keychain keys, extension storage, and
  granted site access on this device.
- Data held by your provider is deleted through your provider account.

## 7. Children

Minimum age: UNKNOWN. Provider age terms apply: UNKNOWN pending review
(blocker 5).

## 8. Security

The key is kept in the system Keychain. Requests go directly from your
device to the provider. No system is perfectly secure.

## 9. International transfers, legal bases, regional rights

Launch countries and applicable regimes (for example GDPR, UK GDPR, CCPA):
UNKNOWN. Counsel must complete this section.

## 10. Changes

Change process and notice: UNKNOWN.

## 11. Contact

UNKNOWN.
