# Product: Scout AI Assistant

Written for the UI/UX review (2026-10-19) from `prd.md`, `replica/design.md`,
project memory and the code. Update it when the product changes.

## What it is

An AI assistant and supervised browser agent that lives in Safari's toolbar on
Mac and in Safari's page menu on iPhone and iPad. People use their own Anthropic
or OpenAI API key. There is no Scout server and no analytics.

## Who it is for

Safari users who want ChatGPT/Comet-style help without leaving Safari: ask
about a page, compare tabs, and let Scout act on a page (Scout mode) with an
approval step before anything sensitive. Shoppers are the sharpest use case:
Find coupons searches about 40 to 100 coupon sites, tests codes at checkout and
keeps the best one.

## Jobs, in order of frequency

1. Ask about the page I am on (summarize, explain, "is this a good price?").
2. Find a working coupon for my cart.
3. Have Scout do a task on the page (Scout mode), and stay in control.
4. Pick up an earlier chat.
5. Set up once: turn on the extension, add a key, choose a model.

## Surfaces

| Surface | Platforms | Code |
| --- | --- | --- |
| Panel: chat, Scout mode, Find coupons, models, chats, Settings, consent | Mac Safari popover (400×600), iPhone/iPad Safari sheet | `src/popup.html`, `src/popup.ts` |
| Scout as its own page (full tab) | Mac Safari | `src/panel/standalone.ts` (`?view=page`) |
| Page button (truck tab on the page edge) | iPhone, iPad, Mac | `src/edge.ts` |
| Scout-mode glow and Working toast on the page | Mac, iPhone | `src/overlay.ts` |
| Setup app (enable extension, where to add the key, legal) | macOS app, iOS app | `apple/App/OnboardingView.swift` |
| Toolbar and app icons | Mac, iPhone | `src/icons`, `apple/App/Assets.xcassets` |

There is no Chrome build and no website.

## Brand personality

Capable, trustworthy, a little adventurous (the scout/truck idea), never cute
at the expense of clarity. Plain words. The app shows real results and real
costs; it never overstates.

## Constraints that shape the design

- Safari owns the iPhone sheet (height, drag, solid background) and its own
  "Scout AI Assistant" bar and checkmark; Scout cannot change them.
- Do not re-propose: a Comet-style in-page quick-ask box (#51, reverted) or a
  half see-through iPhone panel / keyboard on open (#53, reverted).
- No web font requests (no new vendor). Fonts must be system fonts or bundled.
- iOS 26 Safari tints its bottom bar from fixed/overlay page elements; avoid
  them in content scripts.
- WCAG 2.2 AA, both appearances; iOS touch targets 44 pt.
