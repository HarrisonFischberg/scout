# Consent to share with third-party AI — packet for counsel

Status: reviewed by counsel, no changes requested (reported by the owner,
2026-10-16). This covers the consent wording and flow in this packet only;
the privacy policy and terms are still drafts (`publish-checklist.md`).
Prepared 2026-10-16 from the code at commit `015eaeb` plus the link change
recorded in `activity.md` the same day. Not bundled into the app.

Changed after review (Part 2, 2026-10-16): the extension's consent wording
is now version 2 (`src/settings/consent.ts`): it adds the page description,
says form entries, password fields, and hidden fields are left out and secrets
removed, and adds screenshots (per site) and open-tab search (off by default).
Counsel reviewed version 1 only; version 2 is not reviewed
(`docs/launch-blockers.md`, blocker 23). The text below is version 1.

Renamed after review: on 2026-10-16 the product was renamed from "Safari
Scout" to "Scout for Safari". The app's consent wording changed only in the
product name. The text below is kept as counsel reviewed it.

## 1. What we need from you

Please review the wording and flow below against:

- App Store Review Guideline 5.1.2(i): "You must clearly disclose where
  personal data will be shared with third parties, including with
  third-party AI, and obtain explicit permission before doing so."
- Privacy law in the markets we launch in (to be confirmed by the owner;
  launch-blocker 5), for example GDPR / UK GDPR and US state privacy laws.
- Anthropic's and OpenAI's terms for developers whose apps send end-user
  content with the end user's own API key.

The questions are in section 6. Mark up the text in sections 3 and 4
directly; engineering will copy changes into the app word for word.

## 2. How the product works (facts for the review)

- Safari Scout is a Safari extension (Mac, iPhone, iPad) plus a small setup
  app. It has no server. Safari Scout the company receives nothing.
- The user pastes their own Anthropic or OpenAI API key. Requests go
  directly from the user's device to `api.anthropic.com` or
  `api.openai.com` under the user's own provider account, which the
  provider bills.
- Features that send data: chat questions, Summarize page, Control Browser
  (an agent that clicks and types on the page after per-action approval),
  Find coupons (provider web search for codes, then tests codes on the
  cart), testing a key, and loading the provider's model list.
- Password and card fields are replaced with `[REDACTED]` before a page
  snapshot leaves the device. Other text on the page is sent as is, and may
  include personal, financial, or health information.
- Private Browsing: the extension is off; nothing is sent.

## 3. Safari extension: consent dialog (exact text)

Shown as a modal dialog before the first request to a provider, from any of
the features above. One dialog per provider; switching provider asks again.

**Title:** Share with Anthropic?

**Intro:** Safari Scout sends your requests to Anthropic, a third-party AI
provider, using your own API key. Each time you use Safari Scout, Anthropic
receives:

- Your messages and the tasks you type.
- When a request uses the page (questions, Summarize, Control Browser, Find
  coupons): the page's address, title, and text, and for Control Browser
  and Find coupons its links, buttons, and form fields. Password and card
  fields are hidden first.
- Text of other tabs only when you choose them.
- Your API key, only to sign in to Anthropic. Safari Scout never sends it
  anywhere else.

**Links:**

- "Anthropic privacy policy": https://www.anthropic.com/legal/privacy
- "How Anthropic handles API data": https://www.anthropic.com/legal/commercial-terms

**Footer:** Nothing is sent until you choose Allow. You can withdraw this at
any time in Settings.

**Buttons:** Allow / Not now (same style; neither is preselected).

The OpenAI version is identical with "OpenAI" in place of "Anthropic" and
these links:

- "OpenAI privacy policy": https://openai.com/policies/row-privacy-policy/
  (the rest-of-world version; it opens with links to the EU/UK/Switzerland
  and US versions)
- "How OpenAI handles API data": https://openai.com/enterprise-privacy/

Why two links: both privacy policies say they do not apply to content
processed for customers of the providers' business offerings. OpenAI's
names its API; Anthropic's names Enterprise accounts as an example, and
Anthropic's Commercial Terms say they govern "use of Anthropic API keys"
(all checked 2026-10-16).

### Other text in the extension

- After **Not now**, status line: "Nothing was sent. Safari Scout asks
  before it shares anything with Anthropic."
- After **Not now** on a key test: "The key was not tested or saved.
  Safari Scout tests it with Anthropic only after you allow sharing."
- Settings section "Sharing with AI providers": "Safari Scout asks before
  it sends anything to a provider: your messages, and page content when a
  request uses the page. Withdraw to stop all requests to that provider
  until you allow it again." Each provider shows "Anthropic: allowed on
  Oct 16, 2026." (in the device's date format) with a **Withdraw** button, or "Anthropic: not allowed.
  Safari Scout asks before it sends anything."
- After Withdraw: "Withdrawn. Safari Scout sends nothing to Anthropic until
  you allow it again."
- Delete all data: "Removes your API keys from the Keychain, saved settings
  and history, permission to share with AI providers, and site access. Your
  provider keeps its own records under your account."

## 4. iPhone and iPad setup app: consent sheet (exact text)

Shown when the user taps **Test key** for a provider they have not allowed
yet. The sheet cannot be swiped away; the user must choose.

**Title:** Share with Anthropic?

**Intro:** Safari Scout sends your requests to Anthropic, a third-party AI
provider, using your own API key. Anthropic receives:

- Now, to test your key: only the key, so Anthropic can check it.
- Later, in Safari: your messages and the tasks you type.
- When a request uses the page (questions, Summarize, Control Browser, Find
  coupons): the page's address, title, and text, and for Control Browser
  and Find coupons its links, buttons, and form fields. Password and card
  fields are hidden first.
- Text of other tabs only when you choose them.
- Your API key goes only to Anthropic, to sign in. Safari Scout never sends
  it anywhere else.

**Links:** the same two links as the extension.

**Footer:** Nothing is sent until you choose Allow. Safari asks again before
Safari Scout's first request from the browser. You can withdraw this
permission on this screen.

**Buttons:** Not now / Allow.

- After Not now: "Nothing was sent. Safari Scout tests the key with
  Anthropic only after you allow sharing."
- When allowed, the setup screen shows "You allowed this app to share with
  Anthropic to test your key." and a **Withdraw permission** button. After
  withdrawing: "Withdrawn. Safari Scout sends nothing to Anthropic from this
  app until you allow it again."

## 5. What is stored as the record of consent

- Extension: `aiConsent` in Safari's extension storage on the device:
  provider, time allowed, disclosure version. Nothing leaves the device.
- Setup app: a version number per provider in the app's UserDefaults.
- Bumping the disclosure version makes everyone see the dialog again.
- There is no server-side record, so we cannot show proof of a given
  user's consent later.

## 6. Questions for counsel

1. Does the dialog satisfy Guideline 5.1.2(i) as "clear disclosure" and
   "explicit permission", including the timing (just before the first
   request, not at install)?
2. Legal basis under GDPR / UK GDPR: should this be consent, or is sending
   the user's own request to the provider they chose necessary for the
   service the user asked for? If consent, is it "freely given" when the
   features cannot work without it?
3. Who is the controller for data sent to the provider: the user (their own
   account and key), the provider, or us? We have no server and no DPA with
   either provider. Does the wording need to say who is responsible?
4. Page text may contain special-category data (health, finances) about the
   user or others. Do we need an explicit warning in the dialog, beyond the
   privacy policy's section 5?
5. Is one permission per provider enough, or should page content, agent
   control, and coupon web searches each be asked separately?
6. Is a local-only record (section 5) enough evidence of consent?
7. Are the two provider links the right documents for API use with the
   user's own key? Should we link the providers' usage policies too?
8. OpenAI link: is the rest-of-world page (which links to the EU and US
   versions) acceptable for all markets, or should we link by region?
9. The setup app and Safari ask separately because they cannot share
   storage. Is asking twice acceptable, or confusing enough to change?
10. Does anything here change the age requirements (launch-blocker 5,
    safeguard 17)?
