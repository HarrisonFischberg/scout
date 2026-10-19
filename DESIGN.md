# Design: Scout for Safari (current state)

Summary of the design system as built on `main` (2026-10-19). Source of truth
for tokens stays `replica/design/tokens.json` and `replica/design.md`; this file
is the short version for design reviews. Proposed refreshes live in
`impeccable-review/` and are not applied.

## Direction today

System-matched and quiet: Apple neutral grays, one Apple-blue accent for
actions, links and focus, light and dark following the system. Text-first chat.

## Looks (2026-10-19)

Trailhead (sand, forest green, sun yellow, SF Pro Rounded headings) is the default. Settings > Look also offers Pure Apple, Night Ops, Deal Hunter, Ink & Paper and Classic. A look is a token set plus component rules under `:root[data-look="<id>"]` in `src/popup.html`, with a dark set for each; Classic is the base CSS below. Names, swatches and greetings live in `src/panel/look.ts`. Mockups and screenshots: `impeccable-review/`.

## Tokens

| Role | Light | Dark |
| --- | --- | --- |
| Canvas / surface / subtle | `#F5F5F7` / `#FFFFFF` / `#E8E8ED` | `#1C1C1E` / `#2C2C2E` / `#3A3A3C` |
| Text primary / secondary / muted | `#1D1D1F` / `#48484D` / `#65656B` | `#F5F5F7` / `#D1D1D6` / `#AEAEB2` |
| Accent fill / accent text | `#0071E3` / `#0066CC` | `#0073E6` / `#2997FF` |
| Danger | `#B42318` | `#FF8A80` |
| Hairline / control border | `#D9D9DE` / `#8A8A90` | `#3A3A3D` / `#8E8E93` |

## Type

System font (`-apple-system`). Panel body 15 px on Mac, 14 px on iPhone;
question box 16 px (prevents iOS zoom). Headings 15 to 17 px, weights 600 to
650. Settings section labels 13 px uppercase. Monospace for code and coupon
codes. SwiftUI app uses Dynamic Type styles (largeTitle, title2, body).

## Shape and spacing

4 px grid. Radius 8 (controls), 12 (cards), 16 (composer, 22 on iPhone),
999 (pills, round buttons). Header 10/12 px padding, thread 12/14, composer 10.

## Components

Header (chats, logo + name, open as page, new chat, settings) · empty state
(outline truck + two starters) · store suggestions in the composer · composer
(+ menu, Chat/Scout icon switch, model pill, mic, send/stop) · messages (gray
user bubble, plain assistant prose, tables, code, sources) · Scout-mode and
Find coupons trace (steps, attempts, Take control/Stop) · confirm card ·
models sheet (iOS grouped list) · chats drawer · Settings (long single page of
web-form sections) · consent dialog · page button · page glow + toast.

## Motion

150 ms color transitions, chats drawer slide 160 ms, pulse dots while working,
mic pulse; all behind `prefers-reduced-motion: no-preference`.
