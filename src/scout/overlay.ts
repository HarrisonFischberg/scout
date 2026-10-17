// Scouting overlay (Part 3, spec 9). A page-layer overlay drawn by the content
// script on the tab Scout is acting on (platform note 11: Safari has no
// browser-level overlay view). Lives in a closed shadow root so the page can
// neither read nor restyle it. The whole layer lets clicks through
// (pointer-events: none); only the control pill takes input, and only from
// trusted events, so page scripts cannot press its buttons.
//
// Border glow: a conic gradient (savanna gold, amber, acacia green) on a ring
// mask, with a registered @property angle swept around the edge on a 2.5 s
// loop, fading in over 600 ms and out over 400 ms. Reduced motion: static
// border. Hidden tab: the animation pauses. The ring is drawn at a capped
// resolution and scaled up, so a large display does not raster a huge blur.

export type OverlayCommand = "take_control" | "resume" | "stop";
export type OverlayState = "running" | "paused" | "waiting";

export const GOLD = "#E0A526";
export const AMBER = "#C9781E";
export const GREEN = "#6E8B3D";
export const SWEEP_MS = 2500;
export const FADE_IN_MS = 600;
export const FADE_OUT_MS = 400;
export const MARKER_LEAD_MS = 150;
/** Long edge, in CSS px, the ring is rasterized at before scaling up. */
export const RENDER_CAP = 1280;
export const HOST_TAG = "scout-for-safari-overlay";

const STATUS: Record<OverlayState, string> = {
  running: "Scouting…",
  paused: "Paused. You have control.",
  waiting: "Waiting for your answer in Scout.",
};

const GLYPH =
  '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g fill="currentColor">' +
  '<rect x="11.5" y="5" width="11" height="11" rx="2.5"/><rect x="41.5" y="5" width="11" height="11" rx="2.5"/>' +
  '<rect x="26" y="17" width="12" height="11" rx="3"/><rect x="5" y="14" width="24" height="28" rx="7"/>' +
  '<rect x="35" y="14" width="24" height="28" rx="7"/><circle cx="17" cy="44" r="14"/><circle cx="47" cy="44" r="14"/></g>' +
  '<circle fill="#E0A526" cx="17" cy="44" r="8"/><circle fill="#E0A526" cx="47" cy="44" r="8"/></svg>';

export const OVERLAY_CSS = `
@property --scout-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
:host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block; contain: strict; }
.glow { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity ${FADE_IN_MS}ms ease-out; overflow: hidden; }
.glow.on { opacity: 1; }
.glow.off { opacity: 0; transition-duration: ${FADE_OUT_MS}ms; }
.ring {
  position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none;
  padding: 7px; box-sizing: border-box;
  background: conic-gradient(from var(--scout-angle, 0deg), ${GOLD}, ${AMBER}, ${GREEN}, ${AMBER}, ${GOLD});
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;
  animation: scout-sweep ${SWEEP_MS}ms linear infinite;
}
.ring.soft { filter: blur(9px); opacity: 0.75; padding: 14px; }
.ring.crisp { filter: blur(1.2px); }
.paused .ring { animation-play-state: paused; }
@keyframes scout-sweep { to { --scout-angle: 360deg; } }
@media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
.marker {
  position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; pointer-events: none;
  border: 3px solid ${GOLD}; background: rgb(224 165 38 / 25%); box-shadow: 0 0 0 2px rgb(0 0 0 / 25%);
  animation: scout-ripple 700ms ease-out forwards;
}
@keyframes scout-ripple { from { transform: scale(0.35); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .marker { animation: scout-ripple-still 700ms step-end forwards; } }
@keyframes scout-ripple-still { from { opacity: 1; } to { opacity: 0; } }
.pill {
  position: absolute; left: 50%; bottom: max(16px, env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; max-width: calc(100% - 24px); padding: 6px 8px 6px 12px; border-radius: 999px;
  background: rgb(28 28 30 / 92%); color: #f5f5f7; border: 1px solid rgb(255 255 255 / 25%);
  box-shadow: 0 2px 12px rgb(0 0 0 / 35%); font: 600 14px/1.3 -apple-system, system-ui, sans-serif;
  pointer-events: auto; -webkit-font-smoothing: antialiased; white-space: nowrap;
}
.pill svg { width: 20px; height: 20px; flex: none; color: #f5f5f7; }
.pill .status { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; }
.pill button {
  flex: none; min-height: 32px; padding: 4px 12px; border-radius: 999px; border: 1px solid rgb(255 255 255 / 35%);
  background: rgb(255 255 255 / 12%); color: #f5f5f7; font: 600 13px/1 -apple-system, system-ui, sans-serif; cursor: pointer;
}
.pill button:hover { background: rgb(255 255 255 / 22%); }
.pill button:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; }
.pill button.stop { background: ${AMBER}; border-color: ${AMBER}; color: #1d1d1f; }
@media (prefers-reduced-motion: no-preference) { .pill button { transition: background-color 150ms; } }
`;

export interface Overlay {
  show(): void;
  /** Fades out and removes the layer. Resolves once it is gone (at most FADE_OUT_MS). */
  hide(): Promise<void>;
  setState(state: OverlayState): void;
  /** Ripple at a viewport point (CSS px). */
  marker(x: number, y: number): void;
  readonly visible: boolean;
  readonly state: OverlayState;
}

export interface OverlayDeps {
  doc: Document;
  onCommand(command: OverlayCommand): void;
  /** Lets tests shorten the fade. */
  fadeOutMs?: number;
  /** Debug builds only: hands the closed shadow root to the e2e harness when the layer is built or removed. */
  expose?: (root: ShadowRoot | null) => void;
}

export function createOverlay(deps: OverlayDeps): Overlay {
  const { doc } = deps;
  const win = doc.defaultView ?? window;
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let glow: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let control: HTMLButtonElement | null = null;
  let state: OverlayState = "running";
  let hiding: Promise<void> | null = null;

  const sizeRing = (): void => {
    if (!glow) return;
    const w = win.innerWidth;
    const h = win.innerHeight;
    // Render at a capped resolution, then scale up (spec 9, performance).
    const k = Math.max(1, Math.max(w, h) / RENDER_CAP);
    for (const ring of Array.from(glow.querySelectorAll<HTMLElement>(".ring"))) {
      ring.style.width = w / k + "px";
      ring.style.height = h / k + "px";
      ring.style.transform = "scale(" + k + ")";
    }
  };
  const onVisibility = (): void => {
    glow?.classList.toggle("paused", doc.hidden);
  };

  const button = (label: string, className: string, onPress: () => void): HTMLButtonElement => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    // Only a real press counts: a page script cannot reach into the closed
    // root, and a synthetic event that somehow arrives is ignored.
    b.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      e.preventDefault();
      e.stopPropagation();
      onPress();
    });
    return b;
  };

  // @property inside a shadow tree's stylesheet is ignored by browsers;
  // the registration is page-global, so it is made from script (the rule in
  // the stylesheet stays as documentation of the baseline). Without it the
  // border is still drawn, just not swept.
  const registerAngle = (): void => {
    try {
      const css = (win as unknown as { CSS?: { registerProperty?: (d: { name: string; syntax: string; inherits: boolean; initialValue: string }) => void } }).CSS;
      css?.registerProperty?.({ name: "--scout-angle", syntax: "<angle>", inherits: false, initialValue: "0deg" });
    } catch {
      // Already registered (or unsupported): nothing to do.
    }
  };

  const build = (): void => {
    registerAngle();
    host = doc.createElement(HOST_TAG);
    host.setAttribute("data-scout-overlay", "");
    root = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = OVERLAY_CSS;
    glow = doc.createElement("div");
    glow.className = "glow";
    glow.setAttribute("aria-hidden", "true");
    for (const cls of ["ring soft", "ring crisp"]) {
      const ring = doc.createElement("div");
      ring.className = cls;
      glow.appendChild(ring);
    }
    const pill = doc.createElement("div");
    pill.className = "pill";
    pill.setAttribute("role", "group");
    pill.setAttribute("aria-label", "Scout for Safari task");
    const icon = doc.createElement("span");
    icon.innerHTML = GLYPH;
    status = doc.createElement("span");
    status.className = "status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = STATUS.running;
    control = button("Take control", "control", () => deps.onCommand(state === "paused" ? "resume" : "take_control"));
    const stop = button("Stop", "stop", () => deps.onCommand("stop"));
    pill.append(icon.firstElementChild ?? icon, status, control, stop);
    root.append(style, glow, pill);
    (doc.documentElement ?? doc.body).appendChild(host);
    deps.expose?.(root);
    sizeRing();
    win.addEventListener("resize", sizeRing);
    doc.addEventListener("visibilitychange", onVisibility);
    onVisibility();
  };

  const teardown = (): void => {
    win.removeEventListener("resize", sizeRing);
    doc.removeEventListener("visibilitychange", onVisibility);
    host?.remove();
    host = root = glow = status = control = null;
    deps.expose?.(null);
  };

  const overlay: Overlay = {
    get visible() {
      return host !== null && hiding === null;
    },
    get state() {
      return state;
    },
    show() {
      if (hiding) {
        // Shown again mid-fade: keep the layer and cancel the removal.
        hiding = null;
      }
      if (!host) build();
      overlay.setState(state);
      const g = glow!;
      g.classList.remove("off");
      // Two frames so the transition runs from opacity 0.
      win.requestAnimationFrame(() => win.requestAnimationFrame(() => g.classList.add("on")));
    },
    hide() {
      if (!host) return Promise.resolve();
      if (hiding) return hiding;
      const g = glow!;
      g.classList.remove("on");
      g.classList.add("off");
      // The pill goes at once; the glow fades.
      root?.querySelector(".pill")?.remove();
      const ms = deps.fadeOutMs ?? FADE_OUT_MS;
      const p = new Promise<void>((resolve) => {
        win.setTimeout(() => {
          if (hiding === p) {
            teardown();
            hiding = null;
          }
          resolve();
        }, ms);
      });
      hiding = p;
      return p;
    },
    setState(next) {
      state = next;
      if (status) status.textContent = STATUS[next];
      if (control) control.textContent = next === "paused" ? "Resume" : "Take control";
      glow?.classList.toggle("paused", next === "paused" || doc.hidden);
    },
    marker(x, y) {
      if (!root) return;
      const m = doc.createElement("div");
      m.className = "marker";
      m.style.left = x + "px";
      m.style.top = y + "px";
      root.appendChild(m);
      win.setTimeout(() => m.remove(), 800);
    },
  };
  return overlay;
}
