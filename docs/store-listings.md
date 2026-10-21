# Store listings: Chrome Web Store and Firefox Add-ons

Draft text for the owner to paste. Written 2026-10-19. Uses the name
"Scout AI Assistant". Nothing here is submitted by Claude:
each store submission waits for the owner's go-ahead. Safari/App Store fields stay
in `docs/app-store-listing.md`.

## Packages

| Store | File | Build |
| --- | --- | --- |
| Chrome Web Store (also Microsoft Edge Add-ons) | `dist/scout-chrome-<version>.zip` | `npm run build:chrome` |
| Firefox Add-ons (AMO) | `dist/scout-firefox-<version>.zip` | `npm run build:firefox` |

Both are release builds (no diagnostics code). The Firefox add-on ID is
`scout-ai-assistant@harrisonfischberg`; AMO ties the listing to it, so it never changes.

## Shared text

- **Name:** Scout AI Assistant
- **Short description** (Chrome summary max 132 characters; this is 122):
  Your AI assistant in the browser. Summarize pages, ask questions, compare tabs, fill forms and find coupons. Your own key.
- **Category:** Chrome "Productivity > Workflow & Planning"; Firefox "Other" (AMO has no productivity category).
- **Language:** English.
- **Website:** https://rarecreatures.app/apps/scout/
- **Support:** https://rarecreatures.app/support/ and hello@rarecreatures.app
- **Privacy policy:** https://rarecreatures.app/apps/scout/privacy/ (live once the studio-site PR merges)

**Long description:**

> Scout AI Assistant puts a friendly AI helper in your browser's toolbar. Click Scout on any page and:
>
> - Summarize a long page into the short version
> - Ask questions about what you're reading
> - Compare information across your open tabs
> - Let Scout mode click, type and fill out forms for you, with a stop button always on screen
> - Find coupon codes at checkout and try them for you
>
> Bring your own key: Scout uses your Anthropic or OpenAI API key, and you pay your provider directly for what you use. Scout shows an estimated cost after each answer.
>
> Private by design: there is no Scout account and no Scout server. Your questions, and the page you ask about, go straight from your browser to the AI provider you picked, only after you allow it. Your key stays in this browser's local storage and is never synced. No analytics, no ads, no tracking.
>
> Also available for Safari on Mac, iPhone and iPad.
>
> Scout AI Assistant is made by Rare Creatures LLC and is not made by or connected to Google, Mozilla, Apple, Anthropic or OpenAI.

## Chrome Web Store: Privacy practices tab

**Single purpose:** An AI assistant that answers questions about, and acts on, the web page the user is viewing, using the user's own AI provider key.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `activeTab` | Read the page the user asks about when they click Scout. |
| `tabs` | Show the titles of open tabs so the user can attach them to a question, and follow the tab Scout mode is working in. |
| `storage` | Keep settings, chat history (user-controlled, 7 days by default) and the user's API key locally on this computer. |
| `scripting` | Read the page text the user asks about, and click or type on the page when the user starts Scout mode or Find coupons. |
| Host permissions (optional, `http://*/*`, `https://*/*`) | Asked for only when the user turns on site access, so Scout can read pages and other tabs the user attaches, and test coupon codes in the store's own cart. |

**Remote code:** No. All code ships in the package; Scout calls the Anthropic or OpenAI API for answers (data, not code).

**Data usage (tick these):**
- Website content (text, images and links of the page the user asks about): yes, sent to the user's chosen AI provider.
- Web history: no. (Open tab titles and addresses go to the provider only if the user turns on tab search.)
- Authentication information: the user's own API key, stored locally and sent only to that provider to sign in.
- Personal communications, location, financial info, health info, user activity, personally identifiable info: no.

**Certifications (all three apply):** not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.

## Firefox Add-ons (AMO)

- **Data collection declared in the manifest:** website content and browsing activity, required (both go to the user's AI provider). Firefox shows this at install.
- **Source code:** the package is bundled by esbuild, so AMO asks for source. Upload a zip of this repository at the same commit, and paste these build steps in "Notes to reviewer":
  `npm ci && npm run build:firefox` (Node 22) produces `dist/firefox/`.
- **Notes to reviewer:** Scout needs the user's own Anthropic or OpenAI API key; to try it, use a test key with a low spending limit (owner provides at submission, never in this repo). innerHTML is used only for Scout's own fixed markup and for Markdown rendered from escaped text.
- **License:** "All Rights Reserved" (the repo is UNLICENSED).

## Screenshots needed

Chrome: 1 to 5 at 1280x800 (or 640x400), plus a 440x280 small promo tile. Firefox: up to 10, any size, 1280x800 recommended. To take after the rename and Trailhead look merge: summarize, ask, Scout mode, Find coupons, Settings with the key field.

## What only the owner can do

1. Chrome: sign up at https://chrome.google.com/webstore/devconsole (one-time $5 fee, Google account, 2-step verification). Upload the zip, paste the text above, add screenshots, submit.
2. Firefox: sign in at https://addons.mozilla.org/developers/ with a Mozilla account (free). Submit a new add-on, "On this site", upload the zip and the source zip, paste the text, submit.
3. Optional: Microsoft Edge Add-ons at https://partner.microsoft.com/dashboard/microsoftedge (free), same Chrome zip.
