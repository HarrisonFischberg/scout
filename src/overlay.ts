// Scouting overlay (Part 3, spec 9). A content script injected on demand into
// the tab Scout is controlling (spec 11 fallback: Safari has no browser-level
// overlay view for extensions). A full-screen layer that lets every click
// through (pointer-events: none) except on the control pill, an animated
// conic-gradient wash over the whole page (strongest at the edges, lighter in
// the middle; owner changed this from the spec's thin border on 2026-10-17;
// CSS @property angle, 2.5 s sweep, soft blur), a ripple at the point of each
// click, and a small "Working…" toast with the Scout truck and a Stop square. Static border under prefers-reduced-motion; the
// animation pauses while the tab is hidden; the glow renders at half
// resolution and is scaled up. The worker drives it through one handler
// global; the pill's buttons ask the worker to pause or stop the task.
// The page can see the host element (and remove it), but it cannot press the
// buttons: only trusted events count, and the layer never reads the page.
import { request } from "./bridge/messages";
import { OVERLAY_HANDLER, type OverlayRequest } from "./content-api";
import { isPhoneScreen } from "./panel/blur";

const FLAG = "__safariScoutOverlayLoaded";
const g = globalThis as unknown as Record<string, unknown>;

// Safari cyan-blue (owner reference, 2026-10-17: a teal bloom that hugs every
// edge of the page and tints the middle). Hues close together, so the sweep
// reads as one slow swirl rather than patches. Spec 9 named gold, amber and
// green; the owner chose blue.
const BLUES = "#0A84FF, #1A9BE8, #2BBCE6, #33CCF0, #22B4E0, #1496D9, #0E88E0, #1FA8E6, #2EC1EA, #0A84FF";
// How much of the wash shows: center of the page, halfway out, the edges, the corners.
export const GLOW_CENTER = "28%";
export const GLOW_MID = "36%";
export const GLOW_EDGE = "78%";
export const GLOW_CORNER = "95%";
// iPhone shows the glow at three quarters strength (owner, 2026-10-18: on top
// of the panel's page blur the full wash was too heavy). Mac stays at full.
export const PHONE_GLOW_SCALE = 0.75;
// Many close stops, so the fade is smooth rather than banded.
const MASK_STOPS = [
  "rgb(0 0 0 / " + GLOW_CENTER + ") 0%",
  "rgb(0 0 0 / 31%) 25%",
  "rgb(0 0 0 / " + GLOW_MID + ") 45%",
  "rgb(0 0 0 / 46%) 58%",
  "rgb(0 0 0 / 58%) 70%",
  "rgb(0 0 0 / 68%) 78%",
  "rgb(0 0 0 / " + GLOW_EDGE + ") 86%",
  "rgb(0 0 0 / 88%) 94%",
  "rgb(0 0 0 / " + GLOW_CORNER + ") 100%",
].join(", ");

export const FADE_IN_MS = 600;
export const FADE_OUT_MS = 400;
export const SWEEP_MS = 2500;
export const RIPPLE_MS = 450;

// The sweep animates a registered custom property. @property rules are ignored
// inside shadow trees, so the angle is registered on the document instead
// (CSS.registerProperty, Safari 16.4+; a document-level @property rule as the
// fallback). Older Safari gets a static border, which the spec allows.
const ANGLE_STYLE_ID = "scout-overlay-angle";
function registerAngle(): void {
  try {
    (CSS as unknown as { registerProperty(d: { name: string; syntax: string; inherits: boolean; initialValue: string }): void }).registerProperty({
      name: "--scout-angle",
      syntax: "<angle>",
      inherits: false,
      initialValue: "0deg",
    });
    return;
  } catch {
    // Already registered, or unsupported: fall through to the stylesheet form.
  }
  if (document.getElementById(ANGLE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = ANGLE_STYLE_ID;
  style.textContent = '@property --scout-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }';
  (document.head ?? document.documentElement).appendChild(style);
}

const STYLE_TEXT = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity ${FADE_OUT_MS}ms ease; overflow: hidden; }
.layer.on { opacity: 1; transition-duration: ${FADE_IN_MS}ms; }
/* A soft wash over the whole page (owner, 2026-10-17): strongest at the edges,
   lighter but never gone in the middle, so the page reads as "being scouted".
   Rendered at half size and scaled up: caps the blur's raster to a quarter of the pixels. */
.glow {
  position: absolute; left: 0; top: 0; width: 50%; height: 50%; transform: scale(2); transform-origin: 0 0;
  pointer-events: none;
  background: conic-gradient(from var(--scout-angle), ${BLUES});
  -webkit-mask-image: radial-gradient(ellipse at center, ${MASK_STOPS});
  mask-image: radial-gradient(ellipse at center, ${MASK_STOPS});
  filter: blur(26px); animation: scout-sweep ${SWEEP_MS}ms linear infinite;
}
.layer.paused .glow { opacity: 0.5; }
.layer.phone .glow { opacity: ${PHONE_GLOW_SCALE}; }
.layer.phone.paused .glow { opacity: ${PHONE_GLOW_SCALE * 0.5}; }
.layer.hidden-tab .glow { animation-play-state: paused; }
@keyframes scout-sweep { to { --scout-angle: 360deg; } }
.ripple {
  position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; pointer-events: none;
  border: 2px solid #2BBCE6; box-shadow: 0 0 0 2px rgb(43 188 230 / 35%); opacity: 0.95;
  animation: scout-ripple ${RIPPLE_MS}ms ease-out forwards;
}
@keyframes scout-ripple { from { transform: scale(0.4); opacity: 0.95; } to { transform: scale(1.6); opacity: 0; } }
/* "Working…" toast (owner reference, 2026-10-17): teal glass, glowing text, one stop square. */
.pill {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); pointer-events: auto;
  display: flex; align-items: center; gap: 8px; padding: 5px 5px 5px 12px; border-radius: 11px; min-width: 168px;
  font: 13px/1.2 -apple-system, system-ui, sans-serif; color: #d6f4ff; background: rgb(18 44 54 / 86%);
  border: 1px solid rgb(51 204 240 / 28%); box-shadow: 0 4px 18px rgb(0 20 30 / 35%), 0 0 18px rgb(51 204 240 / 25%);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); white-space: nowrap; max-width: calc(100vw - 24px);
}
.pill .glyph { width: 18px; height: 18px; flex: none; color: #8fe3ff; filter: drop-shadow(0 0 4px rgb(51 204 240 / 70%)); }
.pill .glyph .body { fill: currentColor; stroke: rgb(18 44 54); stroke-width: 3; stroke-linejoin: round; }
.pill .glyph .lens { fill: rgb(18 44 54); }
.label { flex: 1; font-weight: 500; letter-spacing: 0.01em; text-shadow: 0 0 8px rgb(51 204 240 / 75%), 0 0 2px rgb(214 244 255 / 60%); }
.pill .sep { width: 1px; height: 20px; background: rgb(51 204 240 / 25%); flex: none; }
.pill button.stop {
  all: initial; cursor: pointer; width: 28px; height: 28px; border-radius: 8px; flex: none;
  background: rgb(51 204 240 / 22%); display: flex; align-items: center; justify-content: center;
}
.pill button.stop::before { content: ""; width: 11px; height: 11px; border-radius: 2px; background: #8fe3ff; box-shadow: 0 0 6px rgb(51 204 240 / 80%); }
.pill button.stop:hover { background: rgb(51 204 240 / 34%); }
.pill button.stop:focus-visible { outline: 2px solid #8fe3ff; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .glow { animation: none; }
  .ripple { animation: none; transform: scale(1); }
  .layer, .layer.on { transition: none; }
}
`;

const HOST_STYLE = [
  "all: initial",
  "display: block",
  "position: fixed",
  "inset: 0",
  "margin: 0",
  "padding: 0",
  "border: 0",
  "width: auto",
  "height: auto",
  "max-width: none",
  "max-height: none",
  "overflow: visible",
  "background: transparent",
  "pointer-events: none",
  "z-index: 2147483647",
  "opacity: 1",
  "visibility: visible",
  "transform: none",
  "filter: none",
  "clip-path: none",
  "contain: none",
  "color-scheme: normal",
]
  .map((d) => d + " !important")
  .join("; ");

  '<circle class="lens" cx="17" cy="44" r="8"/><circle class="lens" cx="47" cy="44" r="8"/></svg>';

type State = "running" | "paused" | "waiting";

const LABEL: Record<State, string> = { running: "Working…", paused: "Paused", waiting: "Waiting for you" };

// Scout truck (design/icons/scout-truck-solid.svg), window, hubs and cut lines in the toast color.
const GLYPH =
  '<svg class="glyph" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g class="body">' +
  '<polygon points="13,26 16.5,11 36,11 40.5,26"/><rect x="5" y="26" width="54" height="17" rx="4"/>' +
  '<circle cx="18" cy="44" r="9"/><circle cx="46" cy="44" r="9"/></g>' +
  '<polygon class="lens" points="21,16 32.5,16 34.5,23 21,23"/><circle class="lens" cx="18" cy="44" r="2.5"/>' +
  '<circle class="lens" cx="46" cy="44" r="2.5"/></svg>';

if (!g[FLAG]) {
  g[FLAG] = true;
  let host: HTMLElement | null = null;
  let layer: HTMLElement | null = null;
  let ripples: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  let taskId = "";
  let state: State = "running";
  let shown = false;
  let removeTimer: ReturnType<typeof setTimeout> | null = null;
  let markers = 0;

  const send = (command: "pause" | "resume" | "stop"): void => {
    void request((m) => browser.runtime.sendMessage(m), "task.control", { task_id: taskId, command }).catch(() => undefined);
  };

  const build = (): void => {
    if (host) return;
    registerAngle();
    host = document.createElement("div");
    host.setAttribute("data-scout-overlay", "");
    host.setAttribute("style", HOST_STYLE);
    // The page can inspect the overlay; it cannot press its buttons (trusted events only).
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE_TEXT;
    layer = document.createElement("div");
    layer.className = isPhoneScreen(matchMedia("(pointer: coarse)").matches, screen.width) ? "layer phone" : "layer";
    layer.setAttribute("role", "group");
    layer.setAttribute("aria-label", "Scout for Safari is controlling this page");
    const glow = document.createElement("div");
    glow.className = "glow";
    glow.setAttribute("aria-hidden", "true");
    ripples = document.createElement("div");
    ripples.className = "ripples";
    ripples.setAttribute("aria-hidden", "true");
    const pill = document.createElement("div");
    pill.className = "pill";
    pill.insertAdjacentHTML("afterbegin", GLYPH);
    label = document.createElement("span");
    label.className = "label";
    label.setAttribute("role", "status");
    label.textContent = LABEL.running;
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.setAttribute("aria-hidden", "true");
    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "stop";
    stopBtn.setAttribute("aria-label", "Stop Scout for Safari");
    stopBtn.title = "Stop";
    // Take control lives in the panel; the toast keeps one control, Stop.
    stopBtn.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      send("stop");
      hide();
    });
    pill.append(label, sep, stopBtn);
    layer.append(glow, ripples, pill);
    root.append(style, layer);
    document.addEventListener("visibilitychange", () => layer?.classList.toggle("hidden-tab", document.hidden));
  };

  // Attached the way the page button is (src/edge.ts, checked in Safari): the
  // popover attribute set before the host joins the document, on the root
  // element, then shown into the top layer so page z-indexes cannot cover the pill.
  const mount = (): void => {
    build();
    const h = host as HTMLElement & { showPopover?(): void };
    if (h.isConnected) return;
    const usePopover = typeof h.showPopover === "function";
    if (usePopover) h.setAttribute("popover", "manual");
    document.documentElement.appendChild(h);
    if (usePopover) {
      try {
        h.showPopover!();
      } catch {
        // Stays a fixed element with the top z-index.
      }
    }
  };

  const setState = (next: State): void => {
    state = next;
    if (!layer || !label) return;
    layer.classList.toggle("paused", next === "paused");
    label.textContent = LABEL[next];
  };

  const show = (id: string, next: State): void => {
    taskId = id;
    if (removeTimer) {
      clearTimeout(removeTimer);
      removeTimer = null;
    }
    mount();
    setState(next);
    layer!.classList.toggle("hidden-tab", document.hidden);
    shown = true;
    // Next frame, so the fade-in transition runs from opacity 0.
    requestAnimationFrame(() => layer?.classList.add("on"));
  };

  const hide = (): void => {
    if (!layer || !host) return;
    shown = false;
    const fading = layer;
    layer.classList.remove("on");
    if (removeTimer) clearTimeout(removeTimer);
    // Gone from the page once the fade-out ends (400 ms, within the 500 ms the
    // spec allows): on the transition's own end event, with a timer as the
    // fallback for reduced motion (no transition) or a page that drops the event.
    let removed = false;
    const remove = (): void => {
      if (removed) return;
      removed = true;
      removeTimer = null;
      fading.removeEventListener("transitionend", remove);
      try {
        if (host?.matches(":popover-open")) (host as HTMLElement & { hidePopover(): void }).hidePopover();
      } catch {
        // ignore
      }
      host?.remove();
    };
    fading.addEventListener("transitionend", remove, { once: true });
    removeTimer = setTimeout(remove, FADE_OUT_MS);
  };

  const marker = (x: number, y: number): void => {
    if (!ripples) return;
    const r = document.createElement("div");
    r.className = "ripple";
    r.style.left = Math.round(x) + "px";
    r.style.top = Math.round(y) + "px";
    ripples.appendChild(r);
    markers++;
    setTimeout(() => r.remove(), RIPPLE_MS + 50);
  };

  g[OVERLAY_HANDLER] = (req: OverlayRequest): unknown => {
    switch (req.type) {
      case "overlay:show":
        show(req.taskId, req.state);
        return true;
      case "overlay:state":
        if (shown) setState(req.state);
        return shown;
      case "overlay:marker":
        if (shown) marker(req.x, req.y);
        return shown;
      case "overlay:hide":
        hide();
        return true;
      case "overlay:status":
        return { shown, state, mounted: !!host?.isConnected, markers, taskId };
      default:
        return null;
    }
  };
}
