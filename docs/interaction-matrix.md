# Interaction matrix

Interaction, motion, gesture and haptics pass, 2026-11-11 (branch `interaction/polish` on `design/bumper`).
Surfaces: **P** the Scout panel (`src/popup.html`, `src/popup.ts`; Safari on Mac and iPhone, Chrome, Firefox),
**A** the iPhone app's own chat (`src/app.html`, `src/app/chat.ts`, in a WKWebView), **N** the native setup screens (`apple/App`).
Every row holds in all seven color schemes: motion and states use only shared tokens, never a scheme's colors.

Status: **done** (this pass), **there** (already in the app), **n/a** (with the reason), **device** (built, needs a real device to feel).
Web pages cannot fire haptics, so P has none; A asks the app for them through its existing bridge.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--press`, `--press-scale`, `--press-scale-icon` | 100ms, 0.97, 0.9 | press squeeze; the larger ratio is for 32px icon buttons, where 0.97 is under a pixel |
| `--dur-local` | 180ms | menus, the confirm sign, a sent question, Undo, Send to Stop |
| `--dur-large` (A only) | 260ms | bottom sheets: Chats and Settings |
| `--ease-out` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | every entrance; no bounce anywhere |
| exits | instant | nothing waits on a closing animation (ideas 12 and 15: see below) |
| Reduce Motion | all of the above off | states still show as tint, opacity, outline and text |

## Components and journeys

| Component or journey | Trigger and intent | Visual response | Gesture + accessible alternative | Haptic | States incl. Reduce Motion | Pri | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pill buttons, round tools, chips, starters (P, A) | tap | squeeze to 0.97, 100ms, transform only | tap, Enter/Space | none (every tap) | pressed, disabled now half opacity (was border only), focus ring; RM: no squeeze | 1 | there + done (disabled) |
| Icon buttons: header, answer actions, close, delete (P, A) | tap | tint + squeeze to 0.9; on touch there was no feedback at all (hover only) | tap, keyboard | none | pressed tint also under RM | 1 | done |
| Rows: chats, models, + menu, store suggestions, sources, look tiles (P, A) | tap | press tint | tap, arrows/Enter where they had them | none | pressed, selected, checked | 1 | done |
| Touch targets (P on iPhone, A) | tap | none | header, composer, close, image remove, Copy code and Copy diagnostics take a 44px-tall tap without growing; header buttons are also 44 wide | none | n/a | 1 | done; still narrower than 44: composer tools (36 wide), answer-action icons (40 wide), the Scout-mode clear (32 tall, beside the question box) |
| Send a question (P, A) | Enter or Send | the question rises 6px and fades in (new ones only, not restored history); Send grows into Stop in place | Enter, button | none | idle, pending (step line / dots), streaming, done, error with retry; RM: appears at once | 1 | done (motion); states there |
| Double send (A) | double tap on a starter or Send | one question | n/a | none | a second tap during the key read or consent is ignored | 1 | done (was sending twice: two requests on the user's account) |
| Double send (P) | same | one question | n/a | none | `activeChat` is set before any await in the common path | 1 | there |
| Stop / cancel (P, A) | Stop, Escape on prompts | Stop turns back into Send; the trace reads "Stopped" | button, keyboard | none | partial text kept; worker gone: ended locally | 1 | there |
| Stale answer (A) | New chat, another chat or Delete while an answer streams | the old answer no longer clears the new request's Stop, blocks the next question, or saves a deleted chat back | n/a | none | cancelled | 1 | done |
| Stale answer (P) | same | message store drops duplicates, gaps and unknown ids; New chat is refused while answering | n/a | none | cancelled | 1 | there (unit + e2e) |
| Streaming scroll (P, A) | answer grows | stays pinned to the end; any scroll up unpins | wheel, touch, scrollbar | none | no animation | 1 | there |
| Delete a chat (P, A) | trash button on the row | row goes, "Chat deleted. Undo" for 7s (stays while focused or hovered) | button; Cmd/Ctrl-Z in the P drawer; focus moves to the next row | none | undo restores the chat beside anything saved since; RM: no rise | 1 | done (was instant and final) |
| Clear chat history (P) | Settings button | "Chat history cleared." + Undo for 7s; "Chat history restored." | button | none | failure text unchanged | 1 | done |
| Delete all chats (A) | Settings button | "N chats deleted." + Undo for 7s | button | none | replaces the system "Are you sure?" alert | 1 | done (owner decision below) |
| Delete all data, Remove key (P, A) | button | inline confirm (P), system alert (A) | button | none | cannot be undone: keys leave the Keychain | 1 | there, kept as confirm |
| + menu (P) | tap + | grows from 0.95 at its bottom-left anchor, 180ms | Escape closes and returns focus; outside tap closes | none | RM: appears at once | 2 | done |
| Confirm sign, tool question (P) | Scout must ask | grows from 0.95, 180ms; Deny focused | buttons, Escape = Deny | none (web) | never dismissed by accident | 2 | done (motion); behaviour there |
| Models sheet (P) | model pill | fades in 160ms (it covers the whole panel, so it does not travel) | arrows, Enter, Escape, Tab trapped | none | RM: appears at once | 2 | done (motion) |
| Chats drawer (P) | header button | slides in 160ms; backdrop now fades in; Tab stays inside | Escape, backdrop tap, Close | none | RM: appears at once | 2 | done (backdrop, Tab trap) |
| Chats and Settings sheets, consent (A) | header buttons | sheet rises from the bottom edge 260ms, backdrop fades; consent grows from 0.95 | native `<dialog>`: Escape, focus trap and restore | none | RM: appears at once | 2 | done |
| Source card (P) | hover or tap a citation chip | fades in 160ms | Escape; the Sources list is the non-hover route | none | RM: appears at once | 3 | done |
| Copy answer, Copy code (P) | tap | the copy icon becomes a check for 1.5s with status text; Copy code reads "Copied" | button | none | failure text | 2 | there |
| Mode switch, look tiles, trace fold (P) | tap | 150ms color change; chevron turn now behind RM | radios, keyboard | A: selection tick on a look pick | selected is outline + weight, not color alone | 2 | there; chevron done |
| Working (P) | task or answer running | header car rolls 4px, pulse dots, step line | Stop | none | RM: static dots, text | 2 | there |
| Key saved / rejected (A) | Save key | status text | button | success / error | checking, saved, rejected, offline | 2 | device |
| Failed answer (A) | request fails | error bubble | n/a | error | text keeps what arrived | 2 | device |
| Setup complete (N) | step done | spring check, SwiftUI | VoiceOver labels | success | RM: fade | 2 | there |
| Edge button on pages (overlay) | drag | tracks the finger, no tween | Settings picks the side | none | n/a | 2 | there, untouched |

## Not applicable

| Idea | Reason |
| --- | --- |
| Stagger rows 30ms (3), stagger details (6) | two starters; the panel must appear at once on iPhone (the owner's "instant open" fixes), and the chat list re-renders after each delete, which would restagger |
| Knob stretch (5), sliders, scrubbers | no custom sliders or knobs; selects and checkboxes stay native |
| Arcs (7), shared-element transitions (20), masks (17) | nothing travels between two places on screen |
| Exit toward trigger (12), shorter exits (15), overlap (16) | closing is instant by choice: a toolbar popover that lingers reads as lag, and `hidden` keeps focus handling simple |
| Rubber-banding (19) | native scrolling only; the panel page turns its own bounce off so Safari's sheet drags cleanly |
| Swipe actions on rows | the iPhone panel lives in Safari's sheet, whose drag-to-dismiss owns vertical drags and whose edge swipe is Back; the visible trash button and Undo cover it |
| Long-press context menu | one action per row (delete) with a visible button; a held press in Safari opens its own callout |
| Drag to reorder | chats are ordered by time, not by the user |
| Pull to refresh | all data is local |
| Pinch / zoom | no images or canvases beyond 56px thumbnails |
| Haptics in the panel | a web page in Safari cannot fire them; not faked |
| Sound | the app has none |

## Checked, and where

Observed in headless WebKit (Playwright): Undo for chat delete and Clear history, Tab trap, one send on a double tap (A),
entrance animations present, nothing animating under Reduce Motion (Bumper and Night Ops), 44px tap height on the iPhone
viewport, axe WCAG 2.2 AA in all seven schemes, light and dark. Not observed: haptics (need an iPhone), press feel under a real
finger, Safari's own sheet and popover around the panel, VoiceOver reading the Undo status.
