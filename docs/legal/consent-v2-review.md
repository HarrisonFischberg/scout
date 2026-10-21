# Consent wording version 2: what goes back to counsel

Prepared 2026-10-21 from `main` at `7d5336d` for the App Store readiness
check. Counsel reviewed version 1 only (`consent-review.md`, owner report
2026-10-16). The app now shows version 2 (`CONSENT_VERSION = 2` in
`src/settings/consent.ts`). Nothing in this file changes the app; it is the
packet for counsel. Launch blockers 23, 32, 34 and 36.

## 1. The extension's consent dialog, version 2 (exact text)

Shown before the first request to a provider. One dialog per provider.

**Title:** Share with Anthropic?

**Intro:** Scout sends your requests to Anthropic, a third-party AI provider,
using your own API key. Each time you use Scout, Anthropic receives:

- Your messages and the tasks you type.
- When a request uses the page (questions, Summarize, Scout mode, Find
  coupons): the page's address, title, description, and text. What you typed
  into forms, password fields, and hidden fields are left out, and passwords,
  keys, and tokens found on the page are removed. Scout mode and Find coupons
  also send the page's links, buttons, and form fields, with password and
  card fields hidden. Scout mode sends them again after each step it takes.
- Other tabs only when you attach them.
- A screenshot of the visible page, only when you allow it for that site. It
  shows everything on screen, including anything typed into the page.
- Titles and addresses of your open tabs, only if you turn on tab search in
  Settings.
- Your API key, only to sign in to Anthropic. Scout never sends it anywhere
  else.

**Links:** "Anthropic privacy policy", "How Anthropic handles API data"
(same two links as version 1; OpenAI version identical with its own links).

**Footer:** Nothing is sent until you choose Allow. You can withdraw this at
any time in Settings.

## 2. What changed since version 1

| Change | In v2 text? | Version bumped? | Blocker |
| --- | --- | --- | --- |
| Page description added to what is sent | yes | yes (v2) | 23 |
| Form entries, password and hidden fields left out; secrets removed | yes | yes (v2) | 23 |
| Screenshots of the visible page, asked per site; they show typed text | yes | yes (v2) | 23 |
| Open-tab titles and addresses when tab search is on (off by default) | yes | yes (v2) | 23 |
| "Control Browser" renamed Scout mode; "Scout mode sends them again after each step it takes" | yes | **no**: people who allowed v2 earlier saw the text without this sentence | 32 |
| Scout works in Private Browsing (v1 facts said it was off); chats from a private tab are deleted when the tab closes | in Settings > Page access, not in the dialog | no | 34 |
| Chat answers may use the provider's own web search (#83, 2026-10-21): the model picks search words from the user's message; never page text or the key | **no** (the dialog does not mention web search at all, for chat or coupons) | no | 36 |
| Scout mode starts a task as soon as it is sent, and the model may start one when the user asks it to do something on the page (Settings > Page access > Scout mode, default On). Sensitive actions are still confirmed each time. v1 facts described per-action approval | not in the dialog | no | 32 |
| iPhone/iPad setup app no longer has key entry, Test key or its own consent sheet (removed from the screen 2026-10-17, code removed 2026-10-21). `consent-review.md` section 4 no longer applies | n/a | n/a | — |

## 3. Questions for counsel

1. Is version 2 acceptable as written for Guideline 5.1.2(i)?
2. Should the dialog name web search (the provider searches the web with
   words taken from the user's message, in chat answers and in Find
   coupons)? If yes, give the sentence; engineering bumps the version.
3. Scout mode re-sending the page after each step was added without a
   version bump. Should everyone be asked again (bump to 3)?
4. Scout mode starts at once and the model may start it; sensitive actions
   are confirmed on the device every time. Is a per-task question needed
   again, or is the Settings switch plus the on-page glow and Stop enough?
5. Private Browsing: the reviewed facts said Scout is off there; it now
   works there, under the same consent. Does the dialog or the policy need a
   sentence about private tabs?
6. Do the answers to `consent-review.md` section 6 still hold now that the
   iPhone app no longer asks separately (question 9 there is moot)?

Whatever counsel changes is copied into `consentText()` word for word, with
`CONSENT_VERSION` raised so everyone is asked again.
