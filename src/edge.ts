// Page button content script (owner request 2026-10-16). The worker registers
// it only on sites the user let Scout access, and only while Settings > Button
// on webpages is on; it never runs in frames or Private Browsing, and it reads
// nothing from the page. It draws a tab on the edge of the viewport in a closed
// shadow root (fixed to the screen on Mac and iPad; on iPhone it rides along in
// the page so Safari's bottom bar stays see-through, see tabInPage). The tab opens itself once, on the first page after install, and
// otherwise stays tucked until the user reaches for it; on touch the first tap
// brings it out and the next one opens Scout (owner requests 2026-10-17). It
// can be dragged up and down or to the other side. Opening it asks the worker to open Scout's toolbar panel
// (Safari's sheet over the page on iPhone). It never puts an extension page in
// the website: Safari runs such a frame in the page's process and kills that
// process when the frame uses extension APIs (owner bug report 2026-10-16).
import { request } from "./bridge/messages";
import {
  clampY,
  isDrag,
  KEY_STEP,
  PAGE_BUTTON_INTRO_KEY,
  PAGE_BUTTON_KEY,
  parsePageButton,
  snapSide,
  tabArea,
  tabInPage,
  tabScale,
  tapOnlyWakes,
  TUCK_AFTER_MS,
  type PageButton,
  type Side,
} from "./panel/edge";

const FLAG = "__safariScoutEdge";
const g = globalThis as unknown as Record<string, unknown>;

const CANT_OPEN = "Couldn't open Scout for Safari here. Use the Scout button in Safari's page menu.";

// Monochrome binoculars (design/icons/safari-scout-binoculars.svg). Lenses are
// drawn in the pill color instead of a mask: url(#id) masks are unreliable
// inside shadow roots.
const GLYPH =
  '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g class="body">' +
  '<rect x="11.5" y="5" width="11" height="11" rx="2.5"/><rect x="41.5" y="5" width="11" height="11" rx="2.5"/>' +
  '<rect x="26" y="17" width="12" height="11" rx="3"/><rect x="5" y="14" width="24" height="28" rx="7"/>' +
  '<rect x="35" y="14" width="24" height="28" rx="7"/><circle cx="17" cy="44" r="14"/><circle cx="47" cy="44" r="14"/></g>' +
  '<circle class="lens" cx="17" cy="44" r="8"/><circle class="lens" cx="47" cy="44" r="8"/></svg>';

// Dark glass in both themes, like Safari's own controls: it stands out on
// light pages, and the light border keeps it visible on dark ones. Awake: a
// 56 x 60 pill in a 60 x 64 target. Tucked: a 16 px sliver in a 32 px target.
// --k scales it back to that size on pages Safari zooms out (tabScale).
const CSS = `
:host { all: initial; }
.tab {
  position: fixed; z-index: 1; top: 45%; right: 0; left: auto; width: 60px; height: 64px; margin: 0; padding: 0;
  border: 0; background: transparent; display: flex; align-items: center; justify-content: flex-end;
  transform: translateY(-50%) scale(var(--k, 1)); transform-origin: right center; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; outline: none;
}
.tab[data-side="left"] { right: auto; left: 0; justify-content: flex-start; transform-origin: left center; }
.tab.tucked { width: 32px; }
.pill {
  box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: 56px; height: 60px;
  border-radius: 30px 0 0 30px; border: 1px solid rgb(255 255 255 / 22%); border-right: 0;
  background: rgb(44 44 46 / 94%); color: #f2f2f7; box-shadow: 0 2px 14px rgb(0 0 0 / 30%);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
}
.tab[data-side="left"] .pill { border-radius: 0 30px 30px 0; border-right: 1px solid rgb(255 255 255 / 22%); border-left: 0; }
.tab.tucked .pill { width: 16px; }
.pill svg { width: 30px; height: 30px; flex: none; }
.pill .body { fill: currentColor; }
.pill .lens { fill: rgb(44 44 46); }
.tab.tucked svg { opacity: 0; }
.tab:focus-visible .pill { outline: 2px solid #2997ff; outline-offset: 2px; }
.tab.dragging { left: 0; right: auto; width: 64px; justify-content: center; transform: translate(-50%, -50%) scale(var(--k, 1)); transform-origin: center; }
.tab.dragging .pill { width: 60px; border-radius: 30px; border: 1px solid rgb(255 255 255 / 22%); }
@media (prefers-reduced-motion: no-preference) {
  .tab:not(.dragging) .pill { transition: width 180ms ease; }
  .pill svg { transition: opacity 150ms ease; }
}
.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); box-sizing: border-box; margin: 0;
  width: max-content; max-width: calc(100vw - 32px); padding: 8px 12px; border-radius: 10px;
  font: 14px/1.4 -apple-system, system-ui, sans-serif; background: rgb(44 44 46); color: #f5f5f7;
}
.toast:empty { display: none; }
`;

// iPhone (tabInPage): the tab and the status line sit in a screen-sized box in
// the page, not fixed to the screen, so Safari keeps its bottom bar see-through.
const IN_PAGE_CSS = `
.tab, .toast { position: absolute; pointer-events: auto; }
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

function mount(initial: PageButton, save: (side: Side, y: number) => void, introduce: boolean): EdgeUi {
  const inPage = tabInPage(viewportInfo().coarse, Math.min(screen.width, screen.height));
  const host = document.createElement("div");
  host.setAttribute("style", HOST_STYLE);
  if (inPage) {
    // Hidden until placed over the screen, so it never flashes at the top of the page.
    for (const [k, v] of [["position", "absolute"], ["pointer-events", "none"], ["visibility", "hidden"]]) host.style.setProperty(k, v, "important");
  }
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML =
    "<style>" + CSS + (inPage ? IN_PAGE_CSS : "") + "</style>" +
    '<button class="tab" type="button" aria-label="Open Scout for Safari"><span class="pill">' + GLYPH + "</span></button>" +
    '<p class="toast" role="status"></p>';
  const tab = root.querySelector("button") as HTMLButtonElement;
  const toastNode = root.querySelector("p") as HTMLParagraphElement;

  let side = initial.side;
  let y = initial.y;
  const placeTab = (): void => {
    tab.dataset.side = side;
    tab.style.top = (y * 100).toFixed(2) + "%";
    tab.style.left = "";
  };
  placeTab();

  // ---------- The screen, as the tab sees it ----------
  // Fixed: the window. In the page: the part of the page on screen now, which
  // the host covers; client coordinates are offset from it by visualViewport.
  const view = (): { x: number; y: number; w: number; h: number } => {
    const vv = window.visualViewport;
    if (!inPage || !vv) return { x: 0, y: 0, w: innerWidth, h: innerHeight };
    return { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height };
  };
  const follow = (): void => {
    if (!inPage) return;
    const vv = window.visualViewport;
    const page = document.scrollingElement ?? document.documentElement;
    const a = tabArea(
      vv ? { left: vv.pageLeft, top: vv.pageTop, width: vv.width, height: vv.height } : { left: scrollX, top: scrollY, width: innerWidth, height: innerHeight },
      page.scrollWidth,
      page.scrollHeight,
    );
    host.style.setProperty("left", a.left + "px", "important");
    host.style.setProperty("top", a.top + "px", "important");
    host.style.setProperty("width", a.width + "px", "important");
    host.style.setProperty("height", a.height + "px", "important");
    host.style.setProperty("visibility", "visible", "important");
  };
  if (inPage) {
    window.addEventListener("scroll", follow, { passive: true });
    window.visualViewport?.addEventListener("scroll", follow);
    window.visualViewport?.addEventListener("resize", follow);
    window.addEventListener("resize", follow);
  }

  // ---------- Same size on screen when Safari zooms the page out ----------
  const rescale = (): void => {
    tab.style.setProperty("--k", String(tabScale(viewportInfo())));
  };
  rescale();
  window.visualViewport?.addEventListener("resize", rescale);
  window.addEventListener("resize", rescale);

  // ---------- Small when not in use ----------
  // Starts tucked except the very first time; only the user brings it out.
  let tuckTimer = 0;
  let pointer: { x: number; y: number; id: number; type: string; wasTucked: boolean } | null = null;
  let dragging = false;
  let suppressClick = false;
  // The tap that brought a tucked tab out (touch): its click does not open Scout.
  let wakeTap = false;
  if (!introduce) tab.classList.add("tucked");
  const scheduleTuck = (): void => {
    window.clearTimeout(tuckTimer);
    tuckTimer = window.setTimeout(() => {
      if (root.activeElement !== tab && !pointer) tab.classList.add("tucked");
    }, TUCK_AFTER_MS);
  };
  const wake = (): void => {
    tab.classList.remove("tucked");
    scheduleTuck();
  };

  // ---------- Move: drag, or arrow keys when focused ----------
  tab.addEventListener("pointerdown", (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    pointer = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType, wasTucked: tab.classList.contains("tucked") };
    dragging = false;
    wakeTap = false;
    wake();
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
    const v = view();
    tab.style.left = e.clientX - v.x + "px";
    tab.style.top = e.clientY - v.y + "px";
  });
  const endPointer = (e: PointerEvent, cancelled: boolean): void => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const ended = pointer;
    pointer = null;
    if (!dragging && !cancelled && tapOnlyWakes(ended.type, ended.wasTucked)) wakeTap = true;
    if (dragging) {
      dragging = false;
      suppressClick = true;
      window.setTimeout(() => (suppressClick = false), 400);
      tab.classList.remove("dragging");
      const v = view();
      if (!cancelled && v.w > 0 && v.h > 0) {
        side = snapSide(e.clientX - v.x, v.w);
        y = clampY((e.clientY - v.y) / v.h);
        save(side, y);
      }
      placeTab();
    }
    wake();
  };
  tab.addEventListener("pointerup", (e) => endPointer(e, false));
  tab.addEventListener("pointercancel", (e) => endPointer(e, true));
  // Hover wakes it for a mouse only: on touch, pointerenter comes with every tap.
  tab.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") wake();
  });
  tab.addEventListener("focus", wake);
  // Losing focus (the panel opening, the user moving on) only lets it tuck again.
  tab.addEventListener("blur", scheduleTuck);
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
    if (wakeTap) {
      wakeTap = false;
      return;
    }
    // Only a real tap or key press opens Scout; page scripts cannot.
    if (!e.isTrusted || opening) return;
    opening = true;
    void request<{ opened?: boolean }>((m) => browser.runtime.sendMessage(m), "panel.open", {})
      .then(
        (r) => r.opened === true,
        () => false,
      )
      .then((opened) => {
        opening = false;
        if (!opened) toast(CANT_OPEN);
      });
  });

  // ---------- Attach ----------
  // Top layer when the browser has popovers, so page overlays do not cover the tab.
  const usePopover = typeof host.showPopover === "function";
  if (usePopover) host.setAttribute("popover", "manual");
  const attach = (): void => {
    document.documentElement.appendChild(host);
    if (usePopover) {
      try {
        host.showPopover();
      } catch {
        // Stays a plain element with the top z-index.
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
  follow();
  if (introduce) wake();

  return {
    place(p) {
      if (pointer) return;
      side = p.side;
      y = p.y;
      placeTab();
    },
    destroy() {
      window.clearTimeout(tuckTimer);
      window.clearTimeout(toastTimer);
      window.visualViewport?.removeEventListener("resize", rescale);
      window.removeEventListener("resize", rescale);
      window.removeEventListener("scroll", follow);
      window.visualViewport?.removeEventListener("scroll", follow);
      window.visualViewport?.removeEventListener("resize", follow);
      window.removeEventListener("resize", follow);
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
  // Open on its own only once, ever: the first page after install shows the full
  // tab, then it waits tucked until the user reaches for it. The flag is saved
  // without waiting, so the tab does not wait for the write either.
  const introduce = (seen: unknown): boolean => {
    if (seen === true) return false;
    void storage.set({ [PAGE_BUTTON_INTRO_KEY]: true }).catch(() => undefined);
    return true;
  };
  // Both settings in one read, while the page is still arriving.
  const [got] = await Promise.all([storage.get([PAGE_BUTTON_KEY, PAGE_BUTTON_INTRO_KEY]).catch(() => none), bodyReady()]);
  let pref = parsePageButton(got[PAGE_BUTTON_KEY]);
  let ui: EdgeUi | null = pref.on ? mount(pref, save, introduce(got[PAGE_BUTTON_INTRO_KEY])) : null;
  browser.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !(PAGE_BUTTON_KEY in changes)) return;
    pref = parsePageButton(changes[PAGE_BUTTON_KEY]?.newValue);
    if (!pref.on) {
      ui?.destroy();
      ui = null;
    } else if (!ui) {
      // Turned on from Settings while this page is open.
      void storage
        .get(PAGE_BUTTON_INTRO_KEY)
        .catch(() => none)
        .then((seen) => {
          if (pref.on && !ui) ui = mount(pref, save, introduce(seen[PAGE_BUTTON_INTRO_KEY]));
        });
    }
    else ui.place(pref);
  });
}

if (!g[FLAG] && window.top === window) {
  g[FLAG] = true;
  void start();
}
