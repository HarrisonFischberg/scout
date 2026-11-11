# Design: Scout AI Assistant (current state)

The design that ships on `main` after the Bumper change (owner choice 2026-11-10).
Source of truth is the CSS in `src/popup.html` (panel) and `src/app.html` (the
iPhone app's own chat); this file is the short version for design reviews.

## Direction: Bumper

The panel is drawn the way the app icon is drawn: thick outlines, flat fills,
rounded type, the green car on a road line in the header, and a yellow road sign
when Scout must ask before it acts. No shadows, no blur, nothing fixed over the
page. Text-first chat; plain words.

## Color schemes (Settings > Look)

Bumper is the structure of every panel. A look only supplies colors: a token set
on `:root[data-look="<id>"]`, light and dark, following the system appearance
(there is no separate light/dark switch). A unit test fails if a look carries
anything but tokens.

| Id | Name | Colors |
| --- | --- | --- |
| `bumper` (default) | Bumper | Scout green on pale leaf white |
| `glasshouse` | Glasshouse | Cool sky and teal |
| `apple` | Pure Apple | System grey and blue, true black in the dark |
| `bento` | Bento | Neutral grey and cobalt |
| `pebble` | Pebble | Soft blue-grey |
| `cinema` | Cinema | Near-black and indigo |
| `nightops` | Night Ops | Black and signal lime |

Names, swatches and greetings live in `src/panel/look.ts`. Someone who never
picked a look gets Bumper; a saved look is kept. On iPhone the pick is shared
with the Scout app's chat through the Keychain group.

## Tokens

Per scheme (light and dark): `--bg-canvas`, `--bg-surface`, `--bg-subtle`,
`--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--accent-on`,
`--accent-text`, `--selected`, `--bubble-user`, `--bubble-user-text`, `--danger`,
`--focus-ring`, `--border-control`, `--hairline`.

Shared by every scheme (the Bumper block):

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--outline` | `--text-primary` | `--border-control` | every outline, the road line, the car's outline |
| `--outline-w` / `--road-w` | 2px / 3px | same | outlines / header road, trace road, sign edge |
| `--sign`, `--sign-ink`, `--sign-edge` | `#ffdf80`, `#16261b`, `#16261b` | `#3a2e00`, `#fff1bf`, `#ffd34d` | the confirm card only |
| `--car-body`, `--car-glass` | `#5b9441`, `#a8d4dd` | same | the mascot, green in every scheme |
| `--r-action`, `--r-box`, `--r-sign`, `--r-field` | 999, 16, 20, 12 px | same | shape lock: actions are pills, boxes 16, the sign 20, fields 12 |
| `--press` | 100ms | same | press feedback |
| `--shadow` | a zero shadow | same | kept so older rules resolve; nothing casts a shadow |

Measured contrast for the default scheme: text on canvas 14.6:1 (light) and
16.0:1 (dark); muted text 6.4 and 8.0; white on the accent 5.2, dark on the dark
accent 8.5; sign text on the sign 12.2 and 11.8; outlines on canvas at least
3.4:1 in every scheme's dark set. The axe run in `tests/e2e/look.spec.ts` checks
new chat and Settings for all seven schemes in both appearances.

## Type

`--font-round`: SF Pro Rounded through `ui-rounded` on Apple platforms; where a
browser has no rounded system face (Chrome, Firefox) it falls back to the system
UI font. No font files ship and nothing is fetched. Body 15px on Mac, 14px on
iPhone, weight 500; the question box is 16px (below that iOS zooms). Two
emphasis weights: 700 for labels and buttons, 800 for names, headings and strong
text. Header name 21px; the confirm action 18px. Sentence case everywhere,
including Settings headings. Monospace only for code and coupon codes.

## Components

- Header: a 3px road line; in the chat the car sits on it beside the name (Mac).
  On iPhone Safari's own bar shows the name, so the header keeps the car, the
  road and the buttons.
- New chat: the car and greeting bottom left, starters as outlined pills.
- Messages: the question is an outlined bubble in the scheme's accent; answers
  are plain prose; tables are an outlined box with a tinted header row; errors
  are outlined in the danger color with their action button.
- Working trace: an outlined pill ("Working 34s") and a 3px road down the side;
  coupon attempts are outlined rows, the winning one tinted and bold.
- Confirm card (spec 8.4): the road sign. The only yellow in the panel, the same
  in every scheme. Buttons in DOM, tab and visual order: Deny, Allow once (equal
  44px pills, side by side), then "Always allow on this site" as a quiet link.
  Deny takes focus when the card opens. A warning triangle sits in the title, so
  the card is never marked by color alone.
- Composer: an outlined box; round tools on a tinted ground; the active mode has
  an inset outline; Send is the accent with an outline.
- Menus, the chats drawer, model sheet and consent dialog: an outline instead of
  a shadow.
- Settings: road line under the title, outlined fields, scheme tiles (the chosen
  one outlined, tinted and ticked).

## Icons and the mascot

One line-icon set (inline SVG, 1.8 stroke, 2.2 in the header). The car is inline
SVG with classes `body`, `glass`, `wheel`, `hub`, so it takes the scheme's
outline color; its green does not change with the scheme. No emoji, no icons on
section headings.

## Motion

150ms color transitions. Buttons, round tools, chips and starters squeeze to
0.97 on press (100ms, transform only). While Scout works the header car rolls
4px along the road and back. The chats drawer slides in 160ms; pulse dots while
working. All of it sits behind `prefers-reduced-motion: no-preference`; with
Reduce Motion nothing moves and every state is still shown in text.

## Shape and spacing

4px grid. Thread padding 12/14, header 8/12, composer margin 10. Touch targets
are 44px on iPhone (starters, confirm buttons including the quiet link).

## Not converted

The native setup app (`apple/App/OnboardingView.swift`) still uses the Glasshouse
colors.
