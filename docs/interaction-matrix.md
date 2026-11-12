# Interaction matrix

Interaction fixes, 2026-11-11 (branch `fixes/from-redesign` on `main`). The look is main's, unchanged: nothing
below shows at rest, and no animation was added. Surfaces: **P** the Scout panel (`src/popup.html`, `src/popup.ts`),
**A** the iPhone app's own chat (`src/app.html`, `src/app/chat.ts`), **N** the native setup screens (`apple/App`).

Status: **done** (this branch), **there** (already on main), **n/a** (with the reason), **device** (built, needs a real device to feel).
Web pages cannot fire haptics, so P has none; A asks the app for them through its existing bridge.

| Component or journey | Trigger and intent | Visual response | Gesture + accessible alternative | Haptic | States incl. Reduce Motion | Pri | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Buttons, icon buttons, round tools, chips, starters, rows (P) | tap | pressed: opacity dips to 0.6, the same in every look; main had no pressed state, and on touch no hover either | tap, Enter/Space | none | pressed, disabled (half opacity; main showed none), focus ring; no motion, so Reduce Motion is the same | 1 | done |
| Buttons and rows (A) | tap | pressed tint or dip, following the tint main's app already used on its icon buttons | tap | none | pressed, disabled | 1 | done |
| Stuck hover (P on touch) | tap an icon button | the hover tint no longer stays after the finger lifts | n/a | none | n/a | 2 | done |
| Touch targets (P on iPhone, A) | tap | none: the buttons look the same | header, composer, close, image remove, Copy code and Undo take a 44px-tall tap without growing | none | n/a | 1 | done; still under 44: composer tools (36 wide), answer-action icons (32 wide), Scout-mode clear (24 tall, beside the question box), Copy diagnostics (28 tall) |
| Double send (A) | double tap on a starter or Send | one question | n/a | none | a second tap during the key read or consent is ignored | 1 | done (was two requests on the user's account) |
| Double send (P) | same | one question | n/a | none | `activeChat` is set before any await in the common path | 1 | there |
| Stop / cancel (P, A) | Stop, Escape on prompts | Stop turns back into Send; the trace reads "Stopped" | button, keyboard | none | partial text kept | 1 | there |
| Stale answer (A) | New chat, another chat or Delete while an answer streams | the old answer no longer clears the new request's Stop, blocks the next question, or saves a deleted chat back | n/a | none | cancelled | 1 | done |
| Stale answer (P) | same | message store drops duplicates, gaps and unknown ids | n/a | none | cancelled | 1 | there |
| Delete a chat (P, A) | trash button on the row | row goes; "Chat deleted. Undo" for 7s (stays while focused; in P also while hovered), drawn with the look's own card and button | button; Cmd/Ctrl-Z in the P drawer; focus moves to the next row | none | undo restores the chat beside anything saved since | 1 | done (was instant and final) |
| Clear chat history (P) | Settings button | "Chat history cleared." + Undo for 7s; "Chat history restored." | button | none | failure text unchanged | 1 | done |
| Delete all chats (A) | Settings button | "N chats deleted." + Undo for 7s | button | none | replaces the system "Are you sure?" alert | 1 | done |
| Delete all data, Remove key (P, A) | button | inline confirm (P), system alert (A) | button | none | cannot be undone | 1 | there |
| Chats drawer (P) | header button | slides in 160ms (main) | Escape, backdrop tap, Close; Tab now stays inside the drawer | none | Reduce Motion: appears at once | 1 | done (Tab trap) |
| Trace fold (P) | tap the trace head | chevron turns 150ms | button | none | the turn now stops under Reduce Motion | 2 | done |
| Key saved / rejected, failed answer, look pick (A) | Save key, a failed request, a look tile | status text, error bubble | button | success / error / selection | checking, saved, rejected, offline | 2 | device |
| Models sheet, + menu, confirm card, source card (P) | their buttons | appear at once (main) | keyboard and Escape as on main | none | n/a | 2 | there, untouched |

## Not applicable or not brought over

| Item | Reason |
| --- | --- |
| Bumper look, its tokens, type, car, road-sign card, "looks as color schemes" | the owner chose main's UI (2026-11-11) |
| Press squeeze, entrance animations (+ menu, confirm card, Models sheet, backdrop, sent question, Send to Stop, app sheets) | new visible motion; left out so main looks and moves as it did |
| 44px-wide header buttons, taller Copy diagnostics | they change the layout at rest |
| Swipe actions, long-press menus, drag to reorder, pull to refresh, pinch zoom | one action per row with a visible button; chats are ordered by time; data is local; Safari's sheet owns the drags |
| Haptics in the panel, sound | a web page in Safari cannot fire haptics; the app has no sound |
