// Scouting overlay (Part 3, spec 9). A content script injected on demand into
// the tab Scout is controlling (spec 11 fallback: Safari has no browser-level
// overlay view for extensions). A full-screen layer that lets every click
// through (pointer-events: none) except on the control pill, an animated
// conic-gradient border (CSS @property angle, 2.5 s sweep, soft blur), a
// ripple at the point of each click, and the pill: binoculars, "Scouting…",
// Take control, Stop. Static border under prefers-reduced-motion; the
// animation pauses while the tab is hidden; the glow renders at half
// resolution and is scaled up. The worker drives it through one handler
// global; the pill's buttons ask the worker to pause or stop the task.
// The page can see the host element (and remove it), but it cannot press the
// buttons: only trusted events count, and the layer never reads the page.
import { request } from "./bridge/messages";
import { OVERLAY_HANDLER, type OverlayRequest } from "./content-api";

const FLAG = "__safariScoutOverlayLoaded";
const g = globalThis as unknown as Record<string, unknown>;

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

// Savanna gold -> amber -> acacia green (spec 9).
const CSS = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity ${FADE_OUT_MS}ms ease; overflow: hidden; }
.layer.on { opacity: 1; transition-duration: ${FADE_IN_MS}ms; }
/* Rendered at half size and scaled up: caps the blur's raster to a quarter of the pixels. */
.glow {
  position: absolute; left: 0; top: 0; width: 50%; height: 50%; transform: scale(2); transform-origin: 0 0;
  padding: 3px; box-sizing: border-box; pointer-events: none;
  background: conic-gradient(from var(--scout-angle), #E0A526, #C9781E, #6E8B3D, #E0A526);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;
  filter: blur(1.5px); animation: scout-sweep ${SWEEP_MS}ms linear infinite;
}
.layer.paused .glow { opacity: 0.5; }
.layer.hidden-tab .glow { animation-play-state: paused; }
@keyframes scout-sweep { to { --scout-angle: 360deg; } }
.ripple {
  position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; pointer-events: none;
  border: 2px solid #E0A526; box-shadow: 0 0 0 2px rgb(224 165 38 / 35%); opacity: 0.95;
  animation: scout-ripple ${RIPPLE_MS}ms ease-out forwards;
}
@keyframes scout-ripple { from { transform: scale(0.4); opacity: 0.95; } to { transform: scale(1.6); opacity: 0; } }
.pill {
  position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); pointer-events: auto;
  display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 12px; border-radius: 999px;
  font: 14px/1.2 -apple-system, system-ui, sans-serif; color: #f5f5f7; background: rgb(44 44 46 / 94%);
  border: 1px solid rgb(255 255 255 / 22%); box-shadow: 0 2px 14px rgb(0 0 0 / 30%);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); white-space: nowrap; max-width: calc(100vw - 24px);
}
.pill svg { width: 20px; height: 20px; flex: none; }
.pill .body { fill: currentColor; }
.pill .lens { fill: rgb(44 44 46); }
.label { font-weight: 600; }
.pill button {
  all: initial; font: 13px/1.2 -apple-system, system-ui, sans-serif; color: #f5f5f7; cursor: pointer; padding: 6px 10px;
  border-radius: 999px; border: 1px solid rgb(255 255 255 / 30%); background: rgb(255 255 255 / 8%);
}
.pill button:hover { background: rgb(255 255 255 / 16%); }
.pill button:focus-visible { outline: 2px solid #2997ff; outline-offset: 2px; }
.pill button.stop { border-color: #E0A526; color: #E0A526; }
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
  "color-scheme: normal",
]
  .map((d) => d + " !important")
  .join("; ");

const GLYPH =
  '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g class="body">' +
  '<rect x="11.5" y="5" width="11" height="11" rx="2.5"/><rect x="41.5" y="5" width="11" height="11" rx="2.5"/>' +
  '<rect x="26" y="17" width="12" height="11" rx="3"/><rect x="5" y="14" width="24" height="28" rx="7"/>' +
  '<rect x="35" y="14" width="24" height="28" rx="7"/><circle cx="17" cy="44" r="14"/><circle cx="47" cy="44" r="14"/></g>' +
  '<circle class="lens" cx="17" cy="44" r="8"/><circle class="lens" cx="47" cy="44" r="8"/></svg>';

type State = "running" | "paused" | "waiting";

const LABEL: Record<State, string> = { running: "Scouting…", paused: "Paused. You have control.", waiting: "Waiting for your answer in Scout" };

if (!g[FLAG]) {
  g[FLAG] = true;
  let host: HTMLElement | null = null;
  let layer: HTMLElement | null = null;
  let ripples: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  let takeBtn: HTMLButtonElement | null = null;
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
    style.textContent = CSS;
    layer = document.createElement("div");
    layer.className = "layer";
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
    takeBtn = document.createElement("button");
    takeBtn.type = "button";
    takeBtn.className = "take";
    takeBtn.textContent = "Take control";
    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "stop";
    stopBtn.textContent = "Stop";
    takeBtn.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      send(state === "paused" ? "resume" : "pause");
    });
    stopBtn.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      send("stop");
      hide();
    });
    pill.append(label, takeBtn, stopBtn);
    layer.append(glow, ripples, pill);
    root.append(style, layer);
    document.addEventListener("visibilitychange", () => layer?.classList.toggle("hidden-tab", document.hidden));
  };

  const mount = (): void => {
    build();
    if (!host!.isConnected) (document.body ?? document.documentElement).appendChild(host!);
    // Top layer where available, so page z-indexes cannot cover the pill.
    try {
      if ("showPopover" in host! && !host!.matches(":popover-open")) {
        host!.setAttribute("popover", "manual");
        (host as HTMLElement & { showPopover(): void }).showPopover();
      }
    } catch {
      // Not supported: the max z-index does the job on most pages.
    }
  };

  const setState = (next: State): void => {
    state = next;
    if (!layer || !label || !takeBtn) return;
    layer.classList.toggle("paused", next === "paused");
    label.textContent = LABEL[next];
    takeBtn.textContent = next === "paused" ? "Resume" : "Take control";
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
    layer.classList.remove("on");
    if (removeTimer) clearTimeout(removeTimer);
    // Gone from the page once the fade-out ends (400 ms, within the 500 ms the spec allows).
    removeTimer = setTimeout(() => {
      removeTimer = null;
      try {
        if (host?.matches(":popover-open")) (host as HTMLElement & { hidePopover(): void }).hidePopover();
      } catch {
        // ignore
      }
      host?.remove();
    }, FADE_OUT_MS);
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
