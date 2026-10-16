# AssistAnt design system (T001)

Tokens: `replica/design/tokens.json`. Contrast evidence: `replica/contrast.txt`
(34 pairs, 0 failing AA, run with the Replica `contrast.py` checker).

## Direction

AssistAnt is a Safari toolbar popup (web extension HTML) and a SwiftUI host
app (macOS and iOS). The popup is a chat surface, so the design is quiet and
text-first: neutral surfaces, one violet accent for actions and focus, and
clear separation between user messages, assistant answers, and agent steps.

The `ui-ux-pro-max` design-system query returned a landing-page pattern
(hero, testimonials, CTA). That pattern does not fit a 360–420 px toolbar
popup, so only its palette direction was used (violet accent, AI-native
styling, visible focus, reduced motion). Its Inter font was not used.

## Decisions

- **Type:** system font stack. Safari extension pages use
  `-apple-system, system-ui, sans-serif`. SwiftUI uses the system font. No web
  font request is made, so no new vendor or data flow is introduced.
- **Base size:** 16 px body, 14 px secondary, 12 px only for timestamps and
  cost labels. Line height 1.5 for message text.
- **Radius:** 12 px for message bubbles and cards, 8 px for controls.
- **Spacing:** 4 px grid. Minimum 8 px between controls. Touch and click
  targets at least 44 × 44 px on iOS and 24 × 24 px on macOS.
- **Colour:** semantic tokens only (`bg-*`, `text-*`, `accent*`, `bubble-*`,
  `danger`, `success`, `focus-ring`, `border-control`). No raw hex in
  components. Light and dark sets are defined side by side, and the app
  follows the system appearance.

## Tokens (summary)

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#F5F5F7` | `#1C1C1E` |
| Surface | `#FFFFFF` | `#2C2C2E` |
| Subtle surface | `#EDEDF2` | `#3A3A3D` |
| Text primary | `#1D1D1F` | `#F5F5F7` |
| Text secondary | `#48484D` | `#D1D1D6` |
| Text muted (helper, timestamps) | `#65656B` | `#AEAEB2` |
| Accent (buttons, links) | `#6D28D9` | `#A78BFA` |
| Text on accent | `#FFFFFF` | `#1A102E` |
| Accent text | `#6D28D9` | `#C4B5FD` |
| User bubble | `#E9E3FB` / `#2E1065` text | `#3B2A6B` / `#F3EEFF` text |
| Danger | `#B42318` | `#FF8A80` |
| Success | `#166534` | `#86EFAC` |
| Focus ring (3:1 UI minimum) | `#6D28D9` | `#C4B5FD` |
| Control border (3:1 UI minimum) | `#8A8A90` | `#8E8E93` |

## Component specs

Each component lists its states. Every state must keep the contrast pairs in
`replica/contrast.txt`.

**Chat message (S04).** User bubble: `bubble-user` background, right-aligned,
max width 85%. Assistant message: `bg-surface`, left-aligned, Markdown body.
States: default, streaming (text grows, a three-dot indicator in
`text-muted`), error (inline `danger` text with a retry button), empty.
Streaming respects `prefers-reduced-motion` by showing a static indicator.

**Composer.** Multi-line text field with a visible label (not placeholder only),
send button in `accent` with `accent-on` text. States: default, focus (2 px
`focus-ring` outline, offset 2 px), disabled while a run is active, no-key
(explains that a key is needed and links to setup).

**Primary button.** `accent` background, `accent-on` text, 8 px radius,
minimum 44 px high on iOS. States: default, hover (darker accent, 150 ms),
focus (`focus-ring` outline), pressed, disabled (text `text-muted`, no
accent fill).

**Secondary button.** `bg-surface` background, `border-control` 1 px border,
`text-primary` label. Same states as primary.

**Agent step list (S05).** One row per planned step: status text (not colour
alone), step title in `text-primary`, detail in `text-secondary`. Statuses:
pending, running, done, failed, blocked. Pause and Stop are buttons with
text labels.

**Approval sheet (S06).** Modal with a heading, the exact action in plain
text, and two buttons: "Approve once" and "Cancel". The default focus goes to
Cancel. Sensitive actions (order submit, login, send, personal-data submit,
download) always show this sheet. Focus is trapped while open and returns to
the trigger on close.

**Cost line (F05).** Token count and estimated cost in `text-muted`, 12 px.
Shows the price table date next to the estimate.

**Warning and danger text.** Use `danger` with an icon and a text label
together. Colour is never the only signal.

**Links.** `accent-text`, underlined.

## Accessibility rules applied at design time

- Visible focus on every interactive control (`focus-ring`, never removed).
- Accessible names on icon-only controls (added in T006 and T007).
- Support for keyboard-only use, VoiceOver, and Full Keyboard Access.
- `prefers-reduced-motion` disables pulsing and streaming animation.
- Dark mode is a full token set, not an inverted palette.

## Intentional differences from the reference

No reference colours, logos, or fonts were copied. The reference palette
was not measured in this task, so no parity claim is made for colour.

## Open items

- Final icon set: SF Symbols on Apple platforms, and one curated set for the
  popup. The icon licence is recorded in `docs/asset-licenses.md` when chosen
  (T006 or T007).
- Visual review on real devices is in T018.
