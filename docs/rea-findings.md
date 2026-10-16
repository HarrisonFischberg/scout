# REA findings

Authorized targets (owner-named, 2026-10-15):
1. `andreapianidev/SafarAI` — public GitHub repo. **No license file**
   (`gh repo view` → `licenseInfo: null`), so all rights reserved. Study
   behavior and configuration only. Copy no code, text, or assets.
2. Perplexity Comet assistant — public marketing page
   https://www.perplexity.ai/comet plus the owner's pasted feature summary.

Authorization and restrictions: public sources only. No Comet account, no
login, no binary analysis, no bundle capture of perplexity.ai.

Methods used (least intrusive first): public README/docs read via `gh api`;
SafarAI `manifest.json` read (config, not logic); one keyword grep of
SafarAI `background.js` for network/storage calls (no matches returned, no
code saved). Comet page read via WebFetch. REA browser tools: no CDP target
available (see `docs/tool-environment.md`), so no REA page capture yet.

Per Replica recon rules, no further SafarAI source is read.

| # | Observation | Evidence | Verified or inferred | Limitation | Informs |
| --- | --- | --- | --- | --- | --- |
| 1 | SafarAI is an Xcode Safari Web Extension: SwiftUI host app + MV3 extension (popup, content script, background module). | repo tree; README "Architecture" | verified | tree only | Same project shape for Safari Scout (Xcode multiplatform Safari extension) |
| 2 | SafarAI requests `<all_urls>` host permission and a content script on every page, plus `tabs`, `scripting`, `contextMenus`. | manifest.json | verified | — | Safari Scout starts from `activeTab` + optional host permissions (safeguard 7) |
| 3 | SafarAI declares `side_panel`, a Chrome API. Safari is not known to support `sidePanel`. | manifest.json | inferred (Safari support unverified) | must test in Safari 27 | Safari Scout uses toolbar popup; on macOS optionally an in-page panel |
| 4 | SafarAI is single-provider (DeepSeek) and Q&A only: no agent actions. | README features | verified (docs) | docs may lag code | Safari Scout adds Anthropic + OpenAI and an agent action layer |
| 5 | SafarAI README says keys live in Keychain; DEVELOPMENT.md says browser local storage. Contradiction. | README vs DEVELOPMENT.md | verified contradiction | did not read code to resolve | Safari Scout stores key in Keychain via native messaging, tested |
| 6 | SafarAI README uses placeholder screenshots; no real UI reference. | README image URLs (via.placeholder.com) | verified | — | Visual direction from ui-ux-pro-max, not SafarAI |
| 7 | Comet assistant: platforms Mac, Windows, iOS, Android; example tasks include buying a product to criteria; shows a "Pause" control during agent runs. | perplexity.ai/comet | verified (public page) | page omits UX, approvals, shortcuts | Safari Scout run view gets Pause/Stop |
| 8 | Comet asks approval before sensitive actions (login, purchase); has @tab multi-tab context, summaries, form fill, shopping, Gmail/Calendar/Notion, history search. | owner-pasted summary | inferred (unverified secondhand) | not checked against product | Feature matrix rows; approval gate design |

## Limitations of this analysis

- No runtime observation of Comet: it is a separate Chromium browser, out of scope without an account.
- Safari API support claims (sidePanel, history, tabGroups, captureVisibleTab on iOS) are inferred and must be verified in build task T002.

## Blockers / unauthorized paths not taken

- No Comet login or bundle capture. No SafarAI code reuse (unlicensed).
