// Page button content script (owner request 2026-10-16). The worker registers
// it only on sites the user let Scout access, and only while Settings > Button
// on webpages is on; it never runs in frames or Private Browsing, and it reads
// nothing from the page. It draws a tab on the edge of the viewport in a closed
// shadow root. It stays out on every page and one tap opens Scout (owner
// request 2026-10-18; it used to tuck into a sliver). It can be dragged up and
// down or to the other side. Opening it asks the worker to open Scout's toolbar panel
// (Safari's sheet over the page on iPhone). It never puts an extension page in
// the website: Safari runs such a frame in the page's process and kills that
// process when the frame uses extension APIs (owner bug report 2026-10-16).
import { request } from "./bridge/messages";
import {
  clampY,
  isDrag,
  KEY_STEP,
  PAGE_BUTTON_KEY,
  parsePageButton,
  PLACE_WAIT_MS,
  snapSide,
  TAB_SIZE,
  tabScale,
  topLayerTab,
  type PageButton,
  type Side,
} from "./panel/edge";

const FLAG = "__safariScoutEdge";
const g = globalThis as unknown as Record<string, unknown>;

// Wakes the worker, which gets the app's native handler running (src/panel/warm.ts).
const warm = (): void => {
  void request((m) => browser.runtime.sendMessage(m), "panel.warm", {}).catch(() => undefined);
};

const CANT_OPEN = "Couldn't open Scout for Safari here. Use the Scout button in Safari's page menu.";

// Monochrome Scout truck (design/icons/scout-truck-solid.svg). Window and hubs are
// drawn in the pill color instead of a mask: url(#id) masks are unreliable
// inside shadow roots.
const GLYPH =
  '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g class="body">' +
  '<polygon points="13,26 16.5,11 36,11 40.5,26"/><rect x="5" y="26" width="54" height="17" rx="4"/>' +
  '<circle cx="18" cy="44" r="9"/><circle cx="46" cy="44" r="9"/></g>' +
  '<polygon class="lens" points="21,16 32.5,16 34.5,23 21,23"/><circle class="lens" cx="18" cy="44" r="2.5"/>' +
  '<circle class="lens" cx="46" cy="44" r="2.5"/></svg>';

// Dark glass in both themes, like Safari's own controls: it stands out on
// light pages, and the light border keeps it visible on dark ones. A
// TAB_SIZE pill in a target 4 px larger each way. --k scales it back to that
// size on pages Safari zooms out (tabScale).
const { width: W, height: H, glyph: G } = TAB_SIZE;
const CSS = `
:host { all: initial; }
.tab {
  position: fixed; z-index: 1; top: 45%; right: 0; left: auto; width: ${W + 4}px; height: ${H + 4}px; margin: 0; padding: 0;
  border: 0; background: transparent; display: flex; align-items: center; justify-content: flex-end;
  transform: translateY(-50%) scale(var(--k, 1)); transform-origin: right center; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; outline: none;
}
.tab[data-side="left"] { right: auto; left: 0; justify-content: flex-start; transform-origin: left center; }
.pill {
  box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: ${W}px; height: ${H}px;
  border-radius: ${H / 2}px 0 0 ${H / 2}px; border: 1px solid rgb(255 255 255 / 22%); border-right: 0;
  background: rgb(44 44 46 / 94%); color: #f2f2f7; box-shadow: 0 2px 14px rgb(0 0 0 / 30%);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
}
.tab[data-side="left"] .pill { border-radius: 0 ${H / 2}px ${H / 2}px 0; border-right: 1px solid rgb(255 255 255 / 22%); border-left: 0; }
.pill svg { width: ${G}px; height: ${G}px; flex: none; }
.pill .body { fill: currentColor; stroke: rgb(44 44 46); stroke-width: 3; stroke-linejoin: round; }
.pill .lens { fill: rgb(44 44 46); }
.tab:focus-visible .pill { outline: 2px solid #2997ff; outline-offset: 2px; }
.tab.dragging { left: 0; right: auto; width: ${H + 4}px; justify-content: center; transform: translate(-50%, -50%) scale(var(--k, 1)); transform-origin: center; }
.tab.dragging .pill { width: ${H}px; border-radius: ${H / 2}px; border: 1px solid rgb(255 255 255 / 22%); }
.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); box-sizing: border-box; margin: 0;
  width: max-content; max-width: calc(100vw - 32px); padding: 8px 12px; border-radius: 10px;
  font: 14px/1.4 -apple-system, system-ui, sans-serif; background: rgb(44 44 46); color: #f5f5f7;
}
.toast:empty { display: none; }
.waiting { visibility: hidden; }
`;

// Inline !important on the host beats any page stylesheet.
const HOST_STYLE = [
  "all: initial",
  "display: block",
  "position: fixed",
  "top: 0",
  "left: 0",
  "width: 0",
  "height: 0",
  "margin: 0",
  "padding: 0",
  "border: 0",
  "overflow: visible",
  "background: transparent",
  "z-index: 2147483647",
  "opacity: 1",
  "visibility: visible",
  "transform: none",
  "filter: none",
  "clip-path: none",
  "contain: none",
  "pointer-events: auto",
]
  .map((d) => d + " !important")
  .join("; ");

interface EdgeUi {
  place(p: PageButton): void;
  /** Shows a tab mounted hidden while its saved place was still loading. */
  reveal(): void;
  destroy(): void;
}

/** Inputs for tabScale, read from this page now. */
function viewportInfo(): Parameters<typeof tabScale>[0] {
  const landscape = matchMedia("(orientation: landscape)").matches;
  const sw = screen.width;
  const sh = screen.height;
  const zoom = Number.parseFloat((getComputedStyle(document.documentElement) as CSSStyleDeclaration & { zoom?: string }).zoom ?? "1");
  return {
    coarse: matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches,
    idealWidth: landscape ? Math.max(sw, sh) : Math.min(sw, sh),
    visualWidth: window.visualViewport?.width ?? innerWidth,
    pageZoom: Number.isFinite(zoom) ? zoom : 1,
  };
}

function mount(initial: PageButton, save: (side: Side, y: number) => void, hidden = false): EdgeUi {
  const host = document.createElement("div");
  host.setAttribute("style", HOST_STYLE);
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML =
    "<style>" + CSS + "</style>" +
    '<button class="tab" type="button" aria-label="Open Scout for Safari"><span class="pill">' + GLYPH + "</span></button>" +
    '<p class="toast" role="status"></p>';
  const tab = root.querySelector("button") as HTMLButtonElement;
  const toastNode = root.querySelector("p") as HTMLParagraphElement;
  if (hidden) tab.classList.add("waiting");

  let side = initial.side;
  let y = initial.y;
  const placeTab = (): void => {
    tab.dataset.side = side;
    tab.style.top = (y * 100).toFixed(2) + "%";
    tab.style.left = "";
  };
  placeTab();

  // ---------- Same size on screen when Safari zooms the page out ----------
  const rescale = (): void => {
    tab.style.setProperty("--k", String(tabScale(viewportInfo())));
  };
  rescale();
  window.visualViewport?.addEventListener("resize", rescale);
  window.addEventListener("resize", rescale);

  let pointer: { x: number; y: number; id: number } | null = null;
  let dragging = false;
  let suppressClick = false;

  // ---------- Move: drag, or arrow keys when focused ----------
  tab.addEventListener("pointerdown", (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    pointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragging = false;
    // A finger on the tab is the earliest sign Scout is wanted: wake the
    // worker and the app's handler now, before the tap ends.
    warm();
    try {
      tab.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (pointer already gone): the drag simply ends early.
    }
  });
  tab.addEventListener("pointermove", (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    if (!dragging && !isDrag(e.clientX - pointer.x, e.clientY - pointer.y)) return;
    dragging = true;
    tab.classList.add("dragging");
    tab.style.left = e.clientX + "px";
    tab.style.top = e.clientY + "px";
  });
  const endPointer = (e: PointerEvent, cancelled: boolean): void => {
    if (!pointer || e.pointerId !== pointer.id) return;
    pointer = null;
    if (dragging) {
      dragging = false;
      suppressClick = true;
      window.setTimeout(() => (suppressClick = false), 400);
      tab.classList.remove("dragging");
      if (!cancelled && innerWidth > 0 && innerHeight > 0) {
        side = snapSide(e.clientX, innerWidth);
        y = clampY(e.clientY / innerHeight);
        save(side, y);
      }
      placeTab();
    }
  };
  tab.addEventListener("pointerup", (e) => endPointer(e, false));
  tab.addEventListener("pointercancel", (e) => endPointer(e, true));
  tab.addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    if (e.key === "ArrowUp") y = clampY(y - KEY_STEP);
    else if (e.key === "ArrowDown") y = clampY(y + KEY_STEP);
    else if (e.key === "ArrowLeft") side = "left";
    else if (e.key === "ArrowRight") side = "right";
    else return;
    e.preventDefault();
    e.stopPropagation();
    placeTab();
    save(side, y);
  });

  // ---------- Status line ----------
  let toastTimer = 0;
  const toast = (text: string): void => {
    toastNode.textContent = text;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastNode.textContent = ""), 5000);
  };

  // ---------- Open Scout ----------
  let opening = false;
  tab.addEventListener("click", (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // Only a real tap or key press opens Scout; page scripts cannot.
    if (!e.isTrusted || opening) return;
    opening = true;
    void request<{ opened?: boolean; reason?: string }>((m) => browser.runtime.sendMessage(m), "panel.open", {})
      .then(
        (r) => ({ opened: r.opened === true, reason: r.reason }),
        // No answer from the worker at all (its own diagnostics cannot see this).
        (err: unknown) => ({ opened: false, reason: "no answer from Scout: " + (err instanceof Error ? err.message : String(err)) }),
      )
      .then(({ opened, reason }) => {
        opening = false;
        // Debug builds: Safari's reason, so a screenshot of the tab says why.
        if (!opened) toast(CANT_OPEN + (__SCOUT_DEBUG__ && reason ? " (" + reason.slice(0, 120) + ")" : ""));
      });
  });

  // ---------- Attach ----------
  // Top layer when the browser has popovers, so page overlays do not cover the
  // tab. Not on iPhone (topLayerTab): every top-layer element gets a
  // full-screen fixed ::backdrop, and Safari 26 takes that as a dimming layer
  // and paints the page background solid under its bottom bar.
  const usePopover = typeof host.showPopover === "function" && topLayerTab(viewportInfo().coarse, Math.min(screen.width, screen.height));
  if (usePopover) host.setAttribute("popover", "manual");
  const attach = (): void => {
    document.documentElement.appendChild(host);
    if (usePopover) {
      try {
        host.showPopover();
      } catch {
        // Stays a fixed element with the top z-index.
      }
    }
  };
  attach();
  // The tab now arrives before the page's own scripts finish. A page that
  // rebuilds its <html> while it loads (some frameworks do) gets the tab put
  // back, a few times at most so it never fights the page.
  let reattach = 3;
  const keep = new MutationObserver(() => {
    if (host.isConnected || reattach <= 0) return;
    reattach -= 1;
    attach();
    keep.observe(document.documentElement, { childList: true });
  });
  keep.observe(document, { childList: true });
  keep.observe(document.documentElement, { childList: true });
  // Get Scout ready while the page loads, so the first tap opens it at once.
  warm();

  return {
    reveal() {
      tab.classList.remove("waiting");
    },
    place(p) {
      if (pointer) return;
      side = p.side;
      y = p.y;
      placeTab();
    },
    destroy() {
      window.clearTimeout(toastTimer);
      window.visualViewport?.removeEventListener("resize", rescale);
      window.removeEventListener("resize", rescale);
      keep.disconnect();
      host.remove();
    },
  };
}

/**
 * Resolves as soon as the page has a body. The script starts at document_start
 * (src/background.ts), before the page has finished loading, so the tab shows
 * while the rest of the page is still downloading instead of after it.
 */
function bodyReady(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      if (!document.body) return;
      observer.disconnect();
      document.removeEventListener("DOMContentLoaded", done);
      resolve();
    };
    const observer = new MutationObserver(done);
    observer.observe(document, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", done);
  });
}

async function start(): Promise<void> {
  const storage = browser.storage?.local;
  if (!storage) return;
  const none = {} as Record<string, unknown>;
  const read = async (): Promise<PageButton> =>
    parsePageButton((await storage.get(PAGE_BUTTON_KEY).catch(() => none))[PAGE_BUTTON_KEY]);
  // Position changes keep whatever on/off state is stored now.
  const save = (side: Side, y: number): void => {
    void read()
      .then((latest) => storage.set({ [PAGE_BUTTON_KEY]: { ...latest, side, y } }))
      .catch(() => undefined);
  };
  // The worker registers this script only while the button is on, so the tab
  // is drawn as soon as the page has a body, without waiting on storage, which
  // can be slow right after Safari starts (owner request 2026-10-18). It stays
  // hidden until the saved place arrives or PLACE_WAIT_MS passes, whichever is
  // first; a stored "off" (turned off a moment ago) removes it again.
  const stored = storage.get(PAGE_BUTTON_KEY).then(
    (got) => parsePageButton(got[PAGE_BUTTON_KEY]),
    () => parsePageButton({ on: true }),
  );
  await bodyReady();
  let pref: PageButton = parsePageButton({ on: true });
  let ui: EdgeUi | null = mount(pref, save, true);
  const waitTimer = window.setTimeout(() => ui?.reveal(), PLACE_WAIT_MS);
  void stored.then((p) => {
    window.clearTimeout(waitTimer);
    pref = p;
    if (!ui) return;
    if (!p.on) {
      ui.destroy();
      ui = null;
      return;
    }
    ui.place(p);
    ui.reveal();
  });
  browser.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !(PAGE_BUTTON_KEY in changes)) return;
    pref = parsePageButton(changes[PAGE_BUTTON_KEY]?.newValue);
    if (!pref.on) {
      ui?.destroy();
      ui = null;
    } else if (!ui) {
      // Turned on from Settings while this page is open.
      ui = mount(pref, save);
    } else ui.place(pref);
  });
}

if (!g[FLAG] && window.top === window) {
  g[FLAG] = true;
  void start();
}
