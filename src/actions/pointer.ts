// Visible pointer for coupon runs (owner request 2026-10-17: "watch you
// physically control the browser"). An arrow drawn over the page glides to
// the element Scout is about to press or type into, shows a ring where it
// clicks, and codes go into the box one character at a time. Purely visual:
// the real actions are the same DOM events as before (dom.ts), and the
// layer lets every click through (pointer-events: none). The host is
// aria-hidden, so snapshots skip it, and its shadow root is closed.
// Content script only; exercised by Playwright (tests/e2e/actions.spec.ts).

export const GLIDE_MS = 380;
export const PRESS_MS = 160;
export const RING_MS = 450;
/** Delay between typed characters. A 10-character code takes about half a second. */
export const KEY_MS = 45;
/** The pointer fades out once Scout has not acted for this long. */
export const IDLE_MS = 3500;

const HOST_ID = "scout-pointer";

// iPhone (owner request 2026-10-19): Safari's sheet with the Scout panel covers
// the bottom half of the page and Scout cannot lower it, so the pointer works
// in the top part instead. An element Scout presses or types into is scrolled
// to a spot in the top quarter, unless it is already in the top part.
/** The share of the page, from the top, that Safari's half-height sheet leaves in view. */
export const ABOVE_SHEET = 0.42;
/** Where the element's middle goes, as a share of the page height. */
export const ABOVE_SHEET_SPOT = 0.22;
/** Its top must stay this far below the top edge (Safari's status bar). */
export const ABOVE_SHEET_MARGIN = 0.06;

/**
 * How far to scroll the page down (negative: up) so an element whose box runs
 * from `top` to `bottom` (viewport px) sits above the sheet. 0 when it already does.
 */
export function aboveSheetScroll(top: number, bottom: number, viewportHeight: number): number {
  if (top >= viewportHeight * ABOVE_SHEET_MARGIN && bottom <= viewportHeight * ABOVE_SHEET) return 0;
  return Math.round((top + bottom) / 2 - viewportHeight * ABOVE_SHEET_SPOT);
}

const STYLE_TEXT = `
:host { all: initial; }
.layer { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; overflow: visible; }
.arrow {
  position: absolute; left: 0; top: 0; width: 26px; height: 32px; pointer-events: none;
  opacity: 0; transition: opacity 200ms ease;
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 35%));
  will-change: transform;
}
.arrow.on { opacity: 1; }
.arrow.glide { transition: opacity 200ms ease, transform ${GLIDE_MS}ms cubic-bezier(0.3, 0.7, 0.2, 1); }
.arrow svg { width: 100%; height: 100%; display: block; transform-origin: 3px 2px; transition: transform ${PRESS_MS / 2}ms ease; }
.arrow.press svg { transform: scale(0.86); }
.ring {
  position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; pointer-events: none;
  border: 2px solid #0A84FF; box-shadow: 0 0 0 2px rgb(10 132 255 / 30%);
  animation: scout-ring ${RING_MS}ms ease-out forwards;
}
@keyframes scout-ring { from { transform: scale(0.4); opacity: 0.95; } to { transform: scale(1.5); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .arrow.glide { transition: opacity 200ms ease; }
  .ring { animation: none; opacity: 0.8; }
}
`;

// Classic arrow cursor: black with a white edge, tip at (3, 2).
const ARROW =
  '<svg viewBox="0 0 26 32" aria-hidden="true" focusable="false">' +
  '<path d="M3 2 L3 25 L8.6 19.8 L12.4 28.6 L16.4 26.9 L12.7 18.2 L20.5 18.2 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>' +
  "</svg>";

// A zero-size box at the top-left corner, drawing outside itself: iPhone
// Safari 26 paints a solid strip under its bottom bar while a page has a
// see-through fixed box over the whole screen (owner bug report 2026-10-19;
// see src/panel/edge.ts topLayerTab). Arrow positions are viewport coordinates either way.
const HOST_STYLE = [
  "all: initial",
  "display: block",
  "position: fixed",
  "left: 0",
  "top: 0",
  "width: 0",
  "height: 0",
  "overflow: visible",
  "pointer-events: none",
  "z-index: 2147483647",
  "visibility: visible",
  "opacity: 1",
  "transform: none",
  "filter: none",
]
  .map((d) => d + " !important")
  .join("; ");

export interface Pointer {
  /** Glide to the middle of `el` (already scrolled into view). */
  moveTo(el: Element): Promise<void>;
  /** The press: a short squeeze of the arrow and a ring at its tip. */
  press(): Promise<void>;
  /** Waits between typed characters. */
  keyPause(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function pagePointer(win: Window): Pointer {
  const doc = win.document;
  const reduced = (): boolean => win.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  let host: HTMLElement | null = null;
  let layer: HTMLElement | null = null;
  let arrow: HTMLElement | null = null;
  let at: { x: number; y: number } | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;

  const mount = (): HTMLElement => {
    // The page may remove the host, or reload; draw a new one when needed.
    if (host?.isConnected && arrow) return arrow;
    host = doc.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("style", HOST_STYLE);
    const root = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = STYLE_TEXT;
    layer = doc.createElement("div");
    layer.className = "layer";
    arrow = doc.createElement("div");
    arrow.className = "arrow";
    arrow.innerHTML = ARROW;
    layer.append(arrow);
    root.append(style, layer);
    doc.documentElement.appendChild(host);
    at = null;
    return arrow;
  };

  const place = (a: HTMLElement, x: number, y: number): void => {
    // The arrow's tip is 3px in and 2px down from its box.
    a.style.transform = "translate(" + Math.round(x - 3) + "px, " + Math.round(y - 2) + "px)";
  };

  const keepAlive = (): void => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      arrow?.classList.remove("on");
      setTimeout(() => {
        if (!arrow?.classList.contains("on")) {
          host?.remove();
          host = layer = arrow = null;
          at = null;
        }
      }, 250);
    }, IDLE_MS);
  };

  return {
    async moveTo(el) {
      const a = mount();
      keepAlive();
      const r = el.getBoundingClientRect();
      // A text box is pressed near its right end, so the arrow does not hide the code being typed.
      const box = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      const x = Math.min(Math.max(box ? r.right - Math.min(24, r.width / 4) : r.left + r.width / 2, 4), win.innerWidth - 4);
      const y = Math.min(Math.max(r.top + r.height / 2, 4), win.innerHeight - 4);
      if (!at) {
        // First appearance: start a little below and to the right of the target.
        a.classList.remove("glide");
        place(a, Math.min(x + 90, win.innerWidth - 20), Math.min(y + 70, win.innerHeight - 20));
        void a.getBoundingClientRect();
        a.classList.add("on");
      }
      const moved = !at || Math.abs(at.x - x) + Math.abs(at.y - y) > 2;
      at = { x, y };
      a.classList.add("glide");
      place(a, x, y);
      if (moved && !reduced()) await sleep(GLIDE_MS);
    },
    async press() {
      const a = mount();
      keepAlive();
      if (!at) return;
      const ring = doc.createElement("div");
      ring.className = "ring";
      ring.style.left = Math.round(at.x) + "px";
      ring.style.top = Math.round(at.y) + "px";
      layer?.appendChild(ring);
      setTimeout(() => ring.remove(), RING_MS + 50);
      a.classList.add("press");
      await sleep(PRESS_MS / 2);
      a.classList.remove("press");
      await sleep(PRESS_MS / 2);
    },
    keyPause: () => {
      keepAlive();
      return sleep(KEY_MS);
    },
  };
}
